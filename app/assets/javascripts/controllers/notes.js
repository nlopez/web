import _ from 'lodash';
import angular from 'angular';
import { SFAuthManager } from 'snjs';
import { PrivilegesManager } from '@/services/privilegesManager';
import { KeyboardManager } from '@/services/keyboardManager';
import {
  APP_STATE_EVENT_NOTE_CHANGED,
  APP_STATE_EVENT_TAG_CHANGED,
  APP_STATE_EVENT_PREFERENCES_CHANGED
} from '@/state';
import template from '%/notes.pug';
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
const MIN_NOTE_CELL_HEIGHT   = 51.0;
const DEFAULT_LIST_NUM_NOTES = 20;

const SORT_KEY_CREATED_AT        = 'created_at';
const SORT_KEY_UPDATED_AT        = 'updated_at';
const SORT_KEY_CLIENT_UPDATED_AT = 'client_updated_at';
const SORT_KEY_TITLE             = 'title';

const ELEMENT_ID_SEARCH_BAR      = 'search-bar';

export class NotesPanel {
  constructor() {
    this.scope = {};
    this.template = template;
    this.replace = true;
    this.controllerAs = 'ctrl';
    this.bindToController = true;
  }

  /* @ngInject */
  controller(
    authManager,
    $timeout,
    $rootScope,
    modelManager,
    syncManager,
    storageManager,
    desktopManager,
    privilegesManager,
    keyboardManager,
    appState,
    preferencesManager
  ) {
    this.panelController = {};
    this.searchSubmitted = false;

    window.onresize = (event) =>   {
      this.resetPagination({
        keepCurrentIfLarger: true
      });
    };

    appState.addObserver((eventName, data) => {
      if(eventName === APP_STATE_EVENT_TAG_CHANGED) {
        if(this.selectedNote && this.selectedNote.dummy) {
          modelManager.removeItemLocally(this.selectedNote);
          this.selectNote(null);
        }
        this.tag = appState.getSelectedTag();
        this.tagDidChange(this.tag, data.previousTag);
      } else if(eventName === APP_STATE_EVENT_NOTE_CHANGED) {
        this.selectedNote = appState.getSelectedNote();
        if(!this.selectedNote) {
          this.reloadNotes().then(() => {
            this.selectNextOrCreateNew();
          });
        }
      } else if(eventName === APP_STATE_EVENT_PREFERENCES_CHANGED) {
        this.loadPreferences();
        this.reloadNotes();
      }
    })

    authManager.addEventHandler((event) => {
      if(event === SFAuthManager.DidSignInEvent) {
        /** Delete dummy note if applicable */
        if(this.selectedNote && this.selectedNote.dummy) {
          modelManager.removeItemLocally(this.selectedNote);
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

    syncManager.addEventHandler((syncEvent, data) => {
      if(syncEvent === 'local-data-loaded') {
        if(this.notes.length == 0) {
          this.createNewNote();
        }
      } else if(syncEvent === 'sync:completed') {
        $timeout(() => {
          if(this.createDummyOnSynCompletionIfNoNotes && this.notes.length == 0) {
            this.createDummyOnSynCompletionIfNoNotes = false;
            this.createNewNote();
          }
        })
      }
    });

    modelManager.addItemSyncObserver(
      'note-list',
      '*',
      (allItems, validItems, deletedItems, source, sourceKey) => {
        if(this.selectedNote &&
          (this.selectedNote.deleted || this.selectedNote.content.trashed)) {
          this.selectNextOrCreateNew();
        }
        this.reloadNotes();

        /** Note has changed values, reset its flags */
        const notes = allItems.filter((item) => item.content_type === 'Note');
        for(const note of notes) {
          this.loadFlagsForNote(note);
          note.cachedCreatedAtString = note.createdAtString();
          note.cachedUpdatedAtString = note.updatedAtString();
        }

        /** Select first note if none is selected */
        if(!this.selectedNote) {
          $timeout(() => {
            /** Required to be in timeout since selecting notes depends on rendered notes */
            this.selectFirstNote();
          })
        }
    });

    this.setNotes = async function(notes) {
      notes = this.filterNotes(notes);
      notes = this.sortNotes(notes, this.sortBy, this.sortReverse);
      for(let note of notes) {
        note.shouldShowTags = this.shouldShowTagsForNote(note);
      }
      this.notes = notes;
      this.reloadPanelTitle();
    }

    this.reloadNotes = async function() {
      const notes = this.tag.notes;
      for(const note of notes) {
        if(note.errorDecrypting) {
          this.loadFlagsForNote(note);
        }
      }
      this.setNotes(notes).then(() => {
        if(!this.notes.includes(this.selectedNote)) {
          this.selectNextOrCreateNew();
        }
      })
    }

    this.reorderNotes = function() {
      this.reloadNotes();
    }

    this.loadPreferences = function() {
      const prevSortValue = this.sortBy;
      this.sortBy = preferencesManager.getValue(
        PREF_SORT_NOTES_BY,
        SORT_KEY_CREATED_AT
      );
      this.sortReverse = preferencesManager.getValue(
        PREF_SORT_NOTES_REVERSE,
        false
      );
      if(this.sortBy === SORT_KEY_UPDATED_AT) {
        /** Use client_updated_at instead */
        this.sortBy = SORT_KEY_CLIENT_UPDATED_AT;
      }
      if(prevSortValue && prevSortValue != this.sortBy) {
        $timeout(() => {
          this.selectFirstNote();
        })
      }
      this.showArchived = preferencesManager.getValue(
        PREF_NOTES_SHOW_ARCHIVED,
        false
      );
      this.hidePinned = preferencesManager.getValue(
        PREF_NOTES_HIDE_PINNED,
        false
      );
      this.hideNotePreview = preferencesManager.getValue(
        PREF_NOTES_HIDE_NOTE_PREVIEW,
        false
      );
      this.hideDate = preferencesManager.getValue(
        PREF_NOTES_HIDE_DATE,
        false
      );
      this.hideTags = preferencesManager.getValue(
        PREF_NOTES_HIDE_TAGS,
        false
      );

      const width = preferencesManager.getValue(PREF_NOTES_PANEL_WIDTH);
      if(width) {
        this.panelController.setWidth(width);
        if(this.panelController.isCollapsed()) {
          appState.panelDidResize({
            name: PANEL_NAME_NOTES,
            collapsed: this.panelController.isCollapsed()
          })
        }
      }
    }

    this.loadPreferences();

    this.onPanelResize = function(newWidth, lastLeft, isAtMaxWidth, isCollapsed) {
      preferencesManager.setUserPrefValue(PREF_NOTES_PANEL_WIDTH, newWidth);
      preferencesManager.syncUserPreferences();
      appState.panelDidResize({
        name: PANEL_NAME_NOTES,
        collapsed: isCollapsed
      });
    }

    angular.element(document).ready(() => {
      this.loadPreferences();
    });

    $rootScope.$on('editorFocused', function(){
      this.showMenu = false;
    }.bind(this))

    $rootScope.$on('noteArchived', function() {
      $timeout(this.selectNextOrCreateNew.bind(this));
    }.bind(this));

    this.selectNextOrCreateNew = function() {
      const displayableNotes = this.displayableNotes();
      let index;
      if(this.selectedIndex < displayableNotes.length) {
        index = Math.max(this.selectedIndex, 0);
      } else {
        index = 0;
      }

      const note = displayableNotes[index];
      if(note) {
        this.selectNote(note);
      } else if(!this.tag || !this.tag.isSmartTag()) {
        this.createNewNote();
      } else {
        this.selectNote(null);
      }
    }

    this.paginate = function() {
      this.notesToDisplay += this.pageSize
      if(this.searchSubmitted) {
        desktopManager.searchText(this.noteFilter.text);
      }
    }

    this.resetPagination = function({keepCurrentIfLarger} = {}) {
      const clientHeight = document.documentElement.clientHeight;
      this.pageSize = clientHeight / MIN_NOTE_CELL_HEIGHT;
      if(this.pageSize === 0) {
        this.pageSize = DEFAULT_LIST_NUM_NOTES;
      }
      if(keepCurrentIfLarger && this.notesToDisplay > this.pageSize) {
        return;
      }
      this.notesToDisplay = this.pageSize;
    }

    this.resetPagination();

    this.reloadPanelTitle = function() {
      if(this.isFiltering()) {
        const resultCount = this.notes.filter((i) => i.visible).length
        this.panelTitle = `${resultCount} search results`;
      } else if(this.tag) {
        this.panelTitle = `${this.tag.title}`;
      }
    }

    this.optionsSubtitle = function() {
      let base = "";
      if(this.sortBy == 'created_at') {
        base += " Date Added";
      } else if(this.sortBy == 'client_updated_at') {
        base += " Date Modified";
      } else if(this.sortBy == 'title') {
        base += " Title";
      }

      if(this.showArchived) {
        base += " | + Archived"
      }
      if(this.hidePinned) {
        base += " | – Pinned"
      }
      if(this.sortReverse) {
        base += " | Reversed"
      }

      return base;
    }

    this.loadFlagsForNote = (note) => {
      let flags = [];

      if(note.pinned) {
        flags.push({
          text: "Pinned",
          class: 'info'
        })
      }

      if(note.archived) {
        flags.push({
          text: "Archived",
          class: 'warning'
        })
      }

      if(note.content.protected) {
        flags.push({
          text: "Protected",
          class: 'success'
        })
      }

      if(note.locked) {
        flags.push({
          text: "Locked",
          class: 'neutral'
        })
      }

      if(note.content.trashed) {
        flags.push({
          text: "Deleted",
          class: 'danger'
        })
      }

      if(note.content.conflict_of) {
        flags.push({
          text: "Conflicted Copy",
          class: 'danger'
        })
      }

      if(note.errorDecrypting) {
        flags.push({
          text: "Missing Keys",
          class: 'danger'
        })
      }

      if(note.deleted) {
        flags.push({
          text: "Deletion Pending Sync",
          class: 'danger'
        })
      }

      note.flags = flags;

      return flags;
    }

    this.tagDidChange = function(tag, oldTag) {
      const scrollable = document.getElementById('notes-scrollable');
      if(scrollable) {
        scrollable.scrollTop = 0;
        scrollable.scrollLeft = 0;
      }

      this.resetPagination();
      this.showMenu = false;

      if(this.selectedNote) {
        if(this.selectedNote.dummy && oldTag) {
          _.remove(oldTag.notes, this.selectedNote);
        }
        this.selectNote(null);
      }

      this.noteFilter.text = "";
      desktopManager.searchText();
      this.reloadNotes().then(() => {
        if(this.notes.length > 0) {
          this.notes.forEach((note) => { note.visible = true; })
          this.selectFirstNote();
        } else if(syncManager.initialDataLoaded()) {
          if(!tag.isSmartTag() || tag.content.isAllTag) {
            this.createNewNote();
          } else {
            if(this.selectedNote && !this.notes.includes(this.selectedNote)) {
              this.selectNote(null);
            }
          }
        }
      })
    }

    this.displayableNotes = function() {
      return this.renderedNotes.filter((note) => {
        return note.visible;
      });
    }

    this.selectFirstNote = function() {
      const displayableNotes = this.displayableNotes();
      if(displayableNotes.length > 0) {
        this.selectNote(displayableNotes[0]);
      }
    }

    this.selectNextNote = function() {
      const displayableNotes = this.displayableNotes();
      const currentIndex = displayableNotes.indexOf(this.selectedNote);
      if(currentIndex + 1 < displayableNotes.length) {
        this.selectNote(displayableNotes[currentIndex + 1]);
      }
    }

    this.selectPreviousNote = function() {
      const displayableNotes = this.displayableNotes();
      const currentIndex = displayableNotes.indexOf(this.selectedNote);
      if(currentIndex - 1 >= 0) {
        this.selectNote(displayableNotes[currentIndex - 1]);
        return true;
      } else {
        return false;
      }
    }

    this.selectNote = async function(note, viaClick = false) {
      if(this.selectedNote === note) {
        return;
      }
      if(!note) {
        appState.setSelectedNote(null);
        return;
      }
      const run = () => {
        $timeout(() => {
          let dummyNote;
          if(this.selectedNote
            && this.selectedNote !== note
            && this.selectedNote.dummy
          ) {
            /** Set this dummy to be removed */
            dummyNote = this.selectedNote;
          }

          appState.setSelectedNote(note);
          this.selectedIndex = Math.max(this.displayableNotes().indexOf(note), 0);

          if(note.content.conflict_of) {
            note.content.conflict_of = null;
            modelManager.setItemDirty(note, true);
            syncManager.sync();
          }

          /**
           * There needs to be a long timeout after setting selection before
           * removing the dummy. Otherwise, you'll click a note, remove this one,
           * and strangely, the click event registers for a lower cell.
           */
          if(dummyNote && dummyNote.dummy == true) {
            $timeout(() => {
              modelManager.removeItemLocally(dummyNote);
              _.pull(this.notes, dummyNote);
            }, 250)
          }

          if(viaClick && this.isFiltering()) {
            desktopManager.searchText(this.noteFilter.text);
          }
        })
      }

      if(note.content.protected &&
        await privilegesManager.actionRequiresPrivilege(
          PrivilegesManager.ActionViewProtectedNotes
        )) {
        privilegesManager.presentPrivilegesModal(
          PrivilegesManager.ActionViewProtectedNotes,
          () => {
            run();
          }
        );
      } else {
        run();
      }
    }

    this.isFiltering = function() {
      return this.noteFilter.text && this.noteFilter.text.length > 0;
    }

    this.createNewNote = function() {
      if(this.selectedNote && this.selectedNote.dummy) {
        return;
      }
      const title = "Note" + (this.notes ? (" " + (this.notes.length + 1)) : "");
      const newNote = modelManager.createItem({
        content_type: 'Note',
        content: {
          text: "",
          title: title
        }
      });
      newNote.client_updated_at = new Date();
      newNote.dummy = true;
      this.addNew(newNote);
      this.selectNote(newNote);
    }

    this.addNew = function(note) {
      modelManager.addItem(note);
      modelManager.setItemDirty(note);
      const selectedTag = appState.getSelectedTag();
      if(!selectedTag.isSmartTag()) {
        selectedTag.addItemAsRelationship(note);
        modelManager.setItemDirty(selectedTag);
      }
    }

    this.noteFilter = {
      text : ''
    };

    this.onFilterEnter = function() {
      // For Desktop, performing a search right away causes input to lose focus.
      // We wait until user explicity hits enter before highlighting desktop search results.
      this.searchSubmitted = true;
      desktopManager.searchText(this.noteFilter.text);
    }

    this.clearFilterText = function() {
      this.noteFilter.text = '';
      this.onFilterEnter();
      this.filterTextChanged();

      // Reset loaded notes
      this.resetPagination();
    }

    this.filterTextChanged = function() {
      if(this.searchSubmitted) {
        this.searchSubmitted = false;
      }
      this.reloadNotes().then(() => {
        if(!this.selectedNote.visible) {
          this.selectFirstNote();
        }
      })
    }

    this.selectedMenuItem = function() {
      this.showMenu = false;
    }

    this.togglePrefKey = function(key) {
      this[key] = !this[key];
      preferencesManager.setUserPrefValue(key, this[key]);
      preferencesManager.syncUserPreferences();
      this.reloadNotes();
    }

    this.selectedSortByCreated = function() {
      this.setSortBy(SORT_KEY_CREATED_AT);
    }

    this.selectedSortByUpdated = function() {
      this.setSortBy(SORT_KEY_CLIENT_UPDATED_AT);
    }

    this.selectedSortByTitle = function() {
      this.setSortBy(SORT_KEY_TITLE);
    }

    this.toggleReverseSort = function() {
      this.selectedMenuItem();
      this.sortReverse = !this.sortReverse;
      this.reorderNotes();
      preferencesManager.setUserPrefValue(
        PREF_SORT_NOTES_REVERSE,
        this.sortReverse
      );
      preferencesManager.syncUserPreferences();
    }

    this.setSortBy = function(type) {
      this.sortBy = type;
      this.reorderNotes();
      preferencesManager.setUserPrefValue(
        PREF_SORT_NOTES_BY,
        this.sortBy
      );
      preferencesManager.syncUserPreferences();
    }

    this.shouldShowTagsForNote = function(note) {
      if(this.hideTags || note.content.protected) {
        return false;
      }

      if(this.tag.content.isAllTag) {
        return note.tags && note.tags.length > 0;
      }

      if(this.tag.isSmartTag()) {
        return true;
      }

      // Inside a tag, only show tags string if note contains tags other than this.tag
      return note.tags && note.tags.length > 1;
    }

    this.filterNotes = function(notes) {
      return notes.filter((note) => {
        let canShowArchived = this.showArchived, canShowPinned = !this.hidePinned;
        let isTrash = this.tag.content.isTrashTag;

        if(!isTrash && note.content.trashed) {
          note.visible = false;
          return note.visible;
        }

        const isSmartTag = this.tag.isSmartTag();
        if(isSmartTag) {
          canShowArchived = canShowArchived || this.tag.content.isArchiveTag || isTrash;
        }

        if((note.archived && !canShowArchived) || (note.pinned && !canShowPinned)) {
          note.visible = false;
          return note.visible;
        }

        const filterText = this.noteFilter.text.toLowerCase();
        if(filterText.length == 0) {
          note.visible = true;
        } else {
          const words = filterText.split(" ");
          const matchesTitle = words.every(function(word) {
            return note.safeTitle().toLowerCase().indexOf(word) >= 0;
          });
          const matchesBody = words.every(function(word) {
            return note.safeText().toLowerCase().indexOf(word) >= 0;
          });
          note.visible = matchesTitle || matchesBody;
        }

        return note.visible;
      });
    }

    this.sortNotes = function(items, sortBy, reverse) {
      let sortValueFn = (a, b, pinCheck = false) => {
        if(a.dummy) { return -1; }
        if(b.dummy) { return 1; }
        if(!pinCheck) {
          if(a.pinned && b.pinned) {
            return sortValueFn(a, b, true);
          }
          if(a.pinned) { return -1; }
          if(b.pinned) { return 1; }
        }

        let aValue = a[sortBy] || "";
        let bValue = b[sortBy] || "";

        let vector = 1;

        if(reverse) {
          vector *= -1;
        }

        if(sortBy == "title") {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();

          if(aValue.length == 0 && bValue.length == 0) {
            return 0;
          } else if(aValue.length == 0 && bValue.length != 0) {
            return 1 * vector;
          } else if(aValue.length != 0 && bValue.length == 0) {
            return -1 * vector;
          } else  {
            vector *= -1;
          }
        }

        if(aValue > bValue) { return -1 * vector;}
        else if(aValue < bValue) { return 1 * vector;}
        return 0;
      }

      items = items || [];
      const result = items.sort(function(a, b){
        return sortValueFn(a, b);
      })
      return result;
    };


    /*
      Keyboard Shortcuts
    */

    // In the browser we're not allowed to override cmd/ctrl + n, so we have to use Control modifier as well.
    // These rules don't apply to desktop, but probably better to be consistent.
    this.newNoteKeyObserver = keyboardManager.addKeyObserver({
      key: 'n',
      modifiers: [
        KeyboardManager.KeyModifierMeta,
        KeyboardManager.KeyModifierCtrl
      ],
      onKeyDown: (event) => {
        event.preventDefault();
        $timeout(() => {
          this.createNewNote();
        });
      }
    })

    this.getSearchBar = function() {
      return document.getElementById(ELEMENT_ID_SEARCH_BAR);
    }

    this.nextNoteKeyObserver = keyboardManager.addKeyObserver({
      key: KeyboardManager.KeyDown,
      elements: [document.body, this.getSearchBar()],
      onKeyDown: (event) => {
        let searchBar = this.getSearchBar();
        if(searchBar == document.activeElement) {
          searchBar.blur()
        }
        $timeout(() => {
          this.selectNextNote();
        });
      }
    })

    this.nextNoteKeyObserver = keyboardManager.addKeyObserver({
      key: KeyboardManager.KeyUp,
      element: document.body,
      onKeyDown: (event) => {
        $timeout(() => {
          this.selectPreviousNote();
        });
      }
    });

    this.searchKeyObserver = keyboardManager.addKeyObserver({
      key: "f",
      modifiers: [
        KeyboardManager.KeyModifierMeta,
        KeyboardManager.KeyModifierShift
      ],
      onKeyDown: (event) => {
        let searchBar = this.getSearchBar();
        if(searchBar) {searchBar.focus()};
      }
    })
  }
}
