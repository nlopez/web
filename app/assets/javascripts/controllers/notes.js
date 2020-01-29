import _ from 'lodash';
import angular from 'angular';
import template from '%/notes.pug';
import { SFAuthManager } from 'snjs';
import { PrivilegesManager } from '@/services/privilegesManager';
import { KeyboardManager } from '@/services/keyboardManager';
import {
  APP_STATE_EVENT_NOTE_CHANGED,
  APP_STATE_EVENT_TAG_CHANGED,
  APP_STATE_EVENT_PREFERENCES_CHANGED,
  APP_STATE_EVENT_EDITOR_FOCUSED
} from '@/state';
import {
  PREF_NOTES_PANEL_WIDTH,
  PREF_SORT_NOTES_BY,
  PREF_SORT_NOTES_REVERSE,
  PREF_NOTES_SHOW_ARCHIVED,
  PREF_NOTES_HIDE_PINNED,
  PREF_NOTES_HIDE_NOTE_PREVIEW,
  PREF_NOTES_HIDE_DATE,
  PREF_NOTES_HIDE_TAGS
} from '@/services/preferencesManager';
import {
  PANEL_NAME_NOTES
} from '@/controllers/constants';

/**
 * This is the height of a note cell with nothing but the title,
 * which *is* a display option
 */
const MIN_NOTE_CELL_HEIGHT = 51.0;
const DEFAULT_LIST_NUM_NOTES = 20;

const SORT_KEY_CREATED_AT = 'created_at';
const SORT_KEY_UPDATED_AT = 'updated_at';
const SORT_KEY_CLIENT_UPDATED_AT = 'client_updated_at';
const SORT_KEY_TITLE = 'title';

const ELEMENT_ID_SEARCH_BAR = 'search-bar';

class NotesCtrl {

  /* @ngInject */
  constructor(
    $timeout,
    $rootScope,
    authManager,
    modelManager,
    syncManager,
    desktopManager,
    privilegesManager,
    keyboardManager,
    appState,
    preferencesManager
  ) {
    this.modelManager = modelManager;
    this.syncManager = syncManager;
    this.appState = appState;
    this.preferencesManager = preferencesManager;
    this.keyboardManager = keyboardManager;
    this.privilegesManager = privilegesManager;
    this.desktopManager = desktopManager;
    this.authManager = authManager;
    this.$rootScope = $rootScope;
    this.$timeout = $timeout;

    this.notes = [];
    this.searchSubmitted = false;
    this.noteFilter = { text: '' };
    this.panelController = {};
    window.onresize = (event) => {
      this.resetPagination({
        keepCurrentIfLarger: true
      });
    };

    this.addAppStateObserver();
    this.addSignInObserver();
    this.addSyncEventHandler();
    this.addMappingObserver();
    this.loadPreferences();
    this.resetPagination();
    this.registerKeyboardShortcuts();
    angular.element(document).ready(() => {
      this.loadPreferences();
    });
  }

  addAppStateObserver() {
    this.appState.addObserver((eventName, data) => {
      if (eventName === APP_STATE_EVENT_TAG_CHANGED) {
        this.tagDidChange(this.appState.getSelectedTag(), data.previousTag);
      } else if (eventName === APP_STATE_EVENT_NOTE_CHANGED) {
        this.selectedNote = this.appState.getSelectedNote();
        if (!this.selectedNote) {
          this.selectNextOrCreateNew();
        }
      } else if (eventName === APP_STATE_EVENT_PREFERENCES_CHANGED) {
        this.loadPreferences();
        this.reloadNotes();
      } else if (eventName === APP_STATE_EVENT_EDITOR_FOCUSED) {
        this.showMenu = false;
      }
    })
  }

  addSignInObserver() {
    this.authManager.addEventHandler((event) => {
      if (event === SFAuthManager.DidSignInEvent) {
        /** Delete dummy note if applicable */
        if (this.selectedNote && this.selectedNote.dummy) {
          this.modelManager.removeItemLocally(this.selectedNote);
          _.pull(this.notes, this.selectedNote);
          this.selectedNote = null;
          this.selectNote(null);
          /**
           * We want to see if the user will download any items from the server.
           * If the next sync completes and our notes are still 0,
           * we need to create a dummy.
           */
          this.createDummyOnSynCompletionIfNoNotes = true;
        }
      }
    })
  }

  addSyncEventHandler() {
    this.syncManager.addEventHandler((syncEvent, data) => {
      if (syncEvent === 'local-data-loaded') {
        if (this.notes.length === 0) {
          this.createNewNote();
        }
      } else if (syncEvent === 'sync:completed') {
        this.$timeout(() => {
          if (this.createDummyOnSynCompletionIfNoNotes && this.notes.length === 0) {
            this.createDummyOnSynCompletionIfNoNotes = false;
            this.createNewNote();
          }
        })
      }
    });
  }

  addMappingObserver() {
    this.modelManager.addItemSyncObserver(
      'note-list',
      '*',
      (allItems, validItems, deletedItems, source, sourceKey) => {
        if (
          this.selectedNote &&
          (this.selectedNote.deleted || this.selectedNote.content.trashed)
        ) {
          this.selectNextOrCreateNew();
        }

        this.reloadNotes();
        if (!this.notes.includes(this.selectedNote)) {
          this.selectNextOrCreateNew();
        }

        /** Note has changed values, reset its flags */
        const notes = allItems.filter((item) => item.content_type === 'Note');
        for (const note of notes) {
          this.loadFlagsForNote(note);
          note.cachedCreatedAtString = note.createdAtString();
          note.cachedUpdatedAtString = note.updatedAtString();
        }

        /** Select first note if none is selected */
        if (!this.selectedNote) {
          this.$timeout(() => {
            /** Required to be in timeout since selecting notes depends on rendered notes */
            this.selectFirstNote();
          })
        }
      });
  }

  reloadNotes() {
    if (!this.tag) {
      return;
    }
    const tagNotes = this.tag.notes;
    const notes = this.sortNotes(
      this.filterNotes(tagNotes),
      this.sortBy,
      this.sortReverse
    );
    for (const note of notes) {
      if (note.errorDecrypting) {
        this.loadFlagsForNote(note);
      }
      note.shouldShowTags = this.shouldShowTagsForNote(note);
    }
    this.notes = notes;
    this.reloadPanelTitle();
  }

  loadPreferences() {
    const prevSortValue = this.sortBy;
    this.sortBy = this.preferencesManager.getValue(
      PREF_SORT_NOTES_BY,
      SORT_KEY_CREATED_AT
    );
    this.sortReverse = this.preferencesManager.getValue(
      PREF_SORT_NOTES_REVERSE,
      false
    );
    if (this.sortBy === SORT_KEY_UPDATED_AT) {
      /** Use client_updated_at instead */
      this.sortBy = SORT_KEY_CLIENT_UPDATED_AT;
    }
    if (prevSortValue && prevSortValue !== this.sortBy) {
      this.$timeout(() => {
        this.selectFirstNote();
      })
    }
    this.showArchived = this.preferencesManager.getValue(
      PREF_NOTES_SHOW_ARCHIVED,
      false
    );
    this.hidePinned = this.preferencesManager.getValue(
      PREF_NOTES_HIDE_PINNED,
      false
    );
    this.hideNotePreview = this.preferencesManager.getValue(
      PREF_NOTES_HIDE_NOTE_PREVIEW,
      false
    );
    this.hideDate = this.preferencesManager.getValue(
      PREF_NOTES_HIDE_DATE,
      false
    );
    this.hideTags = this.preferencesManager.getValue(
      PREF_NOTES_HIDE_TAGS,
      false
    );

    const width = this.preferencesManager.getValue(
      PREF_NOTES_PANEL_WIDTH
    );
    if (width) {
      this.panelController.setWidth(width);
      if (this.panelController.isCollapsed()) {
        this.appState.panelDidResize({
          name: PANEL_NAME_NOTES,
          collapsed: this.panelController.isCollapsed()
        })
      }
    }
  }

  onPanelResize = (newWidth, lastLeft, isAtMaxWidth, isCollapsed) => {
    this.preferencesManager.setUserPrefValue(
      PREF_NOTES_PANEL_WIDTH,
      newWidth
    );
    this.preferencesManager.syncUserPreferences();
    this.appState.panelDidResize({
      name: PANEL_NAME_NOTES,
      collapsed: isCollapsed
    });
  }

  paginate() {
    this.notesToDisplay += this.pageSize
    if (this.searchSubmitted) {
      this.desktopManager.searchText(this.noteFilter.text);
    }
  }

  resetPagination({ keepCurrentIfLarger } = {}) {
    const clientHeight = document.documentElement.clientHeight;
    this.pageSize = clientHeight / MIN_NOTE_CELL_HEIGHT;
    if (this.pageSize === 0) {
      this.pageSize = DEFAULT_LIST_NUM_NOTES;
    }
    if (keepCurrentIfLarger && this.notesToDisplay > this.pageSize) {
      return;
    }
    this.notesToDisplay = this.pageSize;
  }

  reloadPanelTitle() {
    if (this.isFiltering()) {
      const resultCount = this.notes.filter((i) => i.visible).length
      this.panelTitle = `${resultCount} search results`;
    } else if (this.tag) {
      this.panelTitle = `${this.tag.title}`;
    }
  }

  optionsSubtitle() {
    let base = "";
    if (this.sortBy === 'created_at') {
      base += " Date Added";
    } else if (this.sortBy === 'client_updated_at') {
      base += " Date Modified";
    } else if (this.sortBy === 'title') {
      base += " Title";
    }
    if (this.showArchived) {
      base += " | + Archived"
    }
    if (this.hidePinned) {
      base += " | – Pinned"
    }
    if (this.sortReverse) {
      base += " | Reversed"
    }
    return base;
  }

  loadFlagsForNote(note) {
    const flags = [];
    if (note.pinned) {
      flags.push({
        text: "Pinned",
        class: 'info'
      })
    }
    if (note.archived) {
      flags.push({
        text: "Archived",
        class: 'warning'
      })
    }
    if (note.content.protected) {
      flags.push({
        text: "Protected",
        class: 'success'
      })
    }
    if (note.locked) {
      flags.push({
        text: "Locked",
        class: 'neutral'
      })
    }
    if (note.content.trashed) {
      flags.push({
        text: "Deleted",
        class: 'danger'
      })
    }
    if (note.content.conflict_of) {
      flags.push({
        text: "Conflicted Copy",
        class: 'danger'
      })
    }
    if (note.errorDecrypting) {
      flags.push({
        text: "Missing Keys",
        class: 'danger'
      })
    }
    if (note.deleted) {
      flags.push({
        text: "Deletion Pending Sync",
        class: 'danger'
      })
    }
    note.flags = flags;
    return flags;
  }

  async tagDidChange(tag, previousTag) {
    if (this.selectedNote && this.selectedNote.dummy) {
      this.modelManager.removeItemLocally(this.selectedNote);
    }

    this.tag = tag;

    const scrollable = document.getElementById('notes-scrollable');
    if (scrollable) {
      scrollable.scrollTop = 0;
      scrollable.scrollLeft = 0;
    }
    this.resetPagination();
    this.showMenu = false;
    if (this.selectedNote && this.selectedNote.dummy) {
      if (previousTag) {
        _.remove(previousTag.notes, this.selectedNote);
      }
    }

    this.noteFilter.text = '';
    this.desktopManager.searchText();
    this.reloadNotes();
    if (this.notes.length > 0) {
      this.notes.forEach((note) => { note.visible = true; })
      this.selectFirstNote();
    } else if (this.syncManager.initialDataLoaded()) {
      if (!tag.isSmartTag() || tag.content.isAllTag) {
        this.createNewNote();
      } else if (this.selectedNote && !this.notes.includes(this.selectedNote)) {
        this.selectNote(null);
      }
    }
  }

  displayableNotes() {
    return this.renderedNotes.filter((note) => {
      return note.visible;
    });
  }

  getFirstNonProtectedNote() {
    const displayableNotes = this.displayableNotes();
    let index = 0;
    let note = displayableNotes[index];
    while (note && note.content.protected) {
      index++;
      if (index >= displayableNotes.length) {
        break;
      }
      note = displayableNotes[index];
    }
    return note;
  }

  selectFirstNote() {
    const note = this.getFirstNonProtectedNote();
    if (note) {
      this.selectNote(note);
    }
  }

  selectNextNote() {
    const displayableNotes = this.displayableNotes();
    const currentIndex = displayableNotes.indexOf(this.selectedNote);
    if (currentIndex + 1 < displayableNotes.length) {
      this.selectNote(displayableNotes[currentIndex + 1]);
    }
  }

  selectNextOrCreateNew() {
    const note = this.getFirstNonProtectedNote();
    if (note) {
      this.selectNote(note);
    } else if (!this.tag || !this.tag.isSmartTag()) {
      this.createNewNote();
    } else {
      this.selectNote(null);
    }
  }

  selectPreviousNote() {
    const displayableNotes = this.displayableNotes();
    const currentIndex = displayableNotes.indexOf(this.selectedNote);
    if (currentIndex - 1 >= 0) {
      this.selectNote(displayableNotes[currentIndex - 1]);
      return true;
    } else {
      return false;
    }
  }

  async selectNote(note, viaClick = false) {
    if (this.selectedNote === note) {
      return;
    }
    if (!note) {
      this.appState.setSelectedNote(null);
      return;
    }
    const run = () => {
      this.$timeout(() => {
        let dummyNote;
        if (this.selectedNote
          && this.selectedNote !== note
          && this.selectedNote.dummy
        ) {
          /** Set this dummy to be removed */
          dummyNote = this.selectedNote;
        }

        this.appState.setSelectedNote(note);
        this.selectedIndex = Math.max(
          0,
          this.displayableNotes().indexOf(note),
        );

        if (note.content.conflict_of) {
          note.content.conflict_of = null;
          this.modelManager.setItemDirty(note);
          this.syncManager.sync();
        }

        /**
         * There needs to be a long timeout after setting selection before
         * removing the dummy. Otherwise, you'll click a note, remove this one,
         * and strangely, the click event registers for a lower cell.
         */
        if (dummyNote && dummyNote.dummy === true) {
          this.$timeout(() => {
            this.modelManager.removeItemLocally(dummyNote);
            _.pull(this.notes, dummyNote);
          }, 250)
        }

        if (viaClick && this.isFiltering()) {
          this.desktopManager.searchText(this.noteFilter.text);
        }
      })
    }

    if (note.content.protected &&
      await this.privilegesManager.actionRequiresPrivilege(
        PrivilegesManager.ActionViewProtectedNotes
      )) {
      this.privilegesManager.presentPrivilegesModal(
        PrivilegesManager.ActionViewProtectedNotes,
        () => {
          run();
        }
      );
    } else {
      run();
    }
  }

  isFiltering() {
    return this.noteFilter.text && this.noteFilter.text.length > 0;
  }

  createNewNote() {
    if (this.selectedNote && this.selectedNote.dummy) {
      return;
    }
    const title = "Note" + (this.notes ? (" " + (this.notes.length + 1)) : "");
    const newNote = this.modelManager.createItem({
      content_type: 'Note',
      content: {
        text: '',
        title: title
      }
    });
    newNote.client_updated_at = new Date();
    newNote.dummy = true;
    this.addNew(newNote);
    this.selectNote(newNote);
  }

  addNew(note) {
    this.modelManager.addItem(note);
    this.modelManager.setItemDirty(note);
    const selectedTag = this.appState.getSelectedTag();
    if (!selectedTag.isSmartTag()) {
      selectedTag.addItemAsRelationship(note);
      this.modelManager.setItemDirty(selectedTag);
    }
  }

  clearFilterText() {
    this.noteFilter.text = '';
    this.onFilterEnter();
    this.filterTextChanged();
    this.resetPagination();
  }

  filterTextChanged() {
    if (this.searchSubmitted) {
      this.searchSubmitted = false;
    }
    this.reloadNotes().then(() => {
      if (!this.selectedNote.visible) {
        this.selectFirstNote();
      }
    })
  }

  onFilterEnter() {
    /**
     * For Desktop, performing a search right away causes
     * input to lose focus. We wait until user explicity hits
     * enter before highlighting desktop search results.
     */
    this.searchSubmitted = true;
    this.desktopManager.searchText(this.noteFilter.text);
  }

  selectedMenuItem() {
    this.showMenu = false;
  }

  togglePrefKey(key) {
    this[key] = !this[key];
    this.preferencesManager.setUserPrefValue(key, this[key]);
    this.preferencesManager.syncUserPreferences();
    this.reloadNotes();
  }

  selectedSortByCreated() {
    this.setSortBy(SORT_KEY_CREATED_AT);
  }

  selectedSortByUpdated() {
    this.setSortBy(SORT_KEY_CLIENT_UPDATED_AT);
  }

  selectedSortByTitle() {
    this.setSortBy(SORT_KEY_TITLE);
  }

  toggleReverseSort() {
    this.selectedMenuItem();
    this.sortReverse = !this.sortReverse;
    this.reloadNotes();
    this.preferencesManager.setUserPrefValue(
      PREF_SORT_NOTES_REVERSE,
      this.sortReverse
    );
    this.preferencesManager.syncUserPreferences();
  }

  setSortBy(type) {
    this.sortBy = type;
    this.reloadNotes();
    this.preferencesManager.setUserPrefValue(
      PREF_SORT_NOTES_BY,
      this.sortBy
    );
    this.preferencesManager.syncUserPreferences();
  }

  shouldShowTagsForNote(note) {
    if (this.hideTags || note.content.protected) {
      return false;
    }
    if (this.tag.content.isAllTag) {
      return note.tags && note.tags.length > 0;
    }
    if (this.tag.isSmartTag()) {
      return true;
    }
    /**
     * Inside a tag, only show tags string if
     * note contains tags other than this.tag
     */
    return note.tags && note.tags.length > 1;
  }

  filterNotes(notes) {
    return notes.filter((note) => {
      let canShowArchived = this.showArchived;
      const canShowPinned = !this.hidePinned;
      const isTrash = this.tag.content.isTrashTag;
      if (!isTrash && note.content.trashed) {
        note.visible = false;
        return note.visible;
      }
      const isSmartTag = this.tag.isSmartTag();
      if (isSmartTag) {
        canShowArchived = (
          canShowArchived ||
          this.tag.content.isArchiveTag ||
          isTrash
        );
      }
      if (
        (note.archived && !canShowArchived) ||
        (note.pinned && !canShowPinned)
      ) {
        note.visible = false;
        return note.visible;
      }
      const filterText = this.noteFilter.text.toLowerCase();
      if (filterText.length === 0) {
        note.visible = true;
      } else {
        const words = filterText.split(" ");
        const matchesTitle = words.every(function (word) {
          return note.safeTitle().toLowerCase().indexOf(word) >= 0;
        });
        const matchesBody = words.every(function (word) {
          return note.safeText().toLowerCase().indexOf(word) >= 0;
        });
        note.visible = matchesTitle || matchesBody;
      }
      return note.visible;
    });
  }

  sortNotes(items, sortBy, reverse) {
    const sortValueFn = (a, b, pinCheck = false) => {
      if (a.dummy) { return -1; }
      if (b.dummy) { return 1; }
      if (!pinCheck) {
        if (a.pinned && b.pinned) {
          return sortValueFn(a, b, true);
        }
        if (a.pinned) { return -1; }
        if (b.pinned) { return 1; }
      }

      let aValue = a[sortBy] || '';
      let bValue = b[sortBy] || '';
      let vector = 1;
      if (reverse) {
        vector *= -1;
      }
      if (sortBy === SORT_KEY_TITLE) {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
        if (aValue.length === 0 && bValue.length === 0) {
          return 0;
        } else if (aValue.length === 0 && bValue.length !== 0) {
          return 1 * vector;
        } else if (aValue.length !== 0 && bValue.length === 0) {
          return -1 * vector;
        } else {
          vector *= -1;
        }
      }
      if (aValue > bValue) { return -1 * vector; }
      else if (aValue < bValue) { return 1 * vector; }
      return 0;
    }

    items = items || [];
    const result = items.sort(function (a, b) {
      return sortValueFn(a, b);
    })
    return result;
  }

  getSearchBar() {
    return document.getElementById(ELEMENT_ID_SEARCH_BAR);
  }

  registerKeyboardShortcuts() {
    /**
     * In the browser we're not allowed to override cmd/ctrl + n, so we have to
     * use Control modifier as well. These rules don't apply to desktop, but
     * probably better to be consistent.
     */
    this.newNoteKeyObserver = this.keyboardManager.addKeyObserver({
      key: 'n',
      modifiers: [
        KeyboardManager.KeyModifierMeta,
        KeyboardManager.KeyModifierCtrl
      ],
      onKeyDown: (event) => {
        event.preventDefault();
        this.$timeout(() => {
          this.createNewNote();
        });
      }
    })

    this.nextNoteKeyObserver = this.keyboardManager.addKeyObserver({
      key: KeyboardManager.KeyDown,
      elements: [
        document.body,
        this.getSearchBar()
      ],
      onKeyDown: (event) => {
        const searchBar = this.getSearchBar();
        if (searchBar === document.activeElement) {
          searchBar.blur()
        }
        this.$timeout(() => {
          this.selectNextNote();
        });
      }
    })

    this.nextNoteKeyObserver = this.keyboardManager.addKeyObserver({
      key: KeyboardManager.KeyUp,
      element: document.body,
      onKeyDown: (event) => {
        this.$timeout(() => {
          this.selectPreviousNote();
        });
      }
    });

    this.searchKeyObserver = this.keyboardManager.addKeyObserver({
      key: "f",
      modifiers: [
        KeyboardManager.KeyModifierMeta,
        KeyboardManager.KeyModifierShift
      ],
      onKeyDown: (event) => {
        const searchBar = this.getSearchBar();
        if (searchBar) { searchBar.focus() };
      }
    })
  }
}

export class NotesPanel {
  constructor() {
    this.scope = {};
    this.template = template;
    this.replace = true;
    this.controller = NotesCtrl;
    this.controllerAs = 'ctrl';
    this.bindToController = true;
  }
}
