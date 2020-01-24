import { SNNote, SNSmartTag } from 'snjs';
import template from '%/tags.pug';
import { APP_STATE_EVENT_PREFERENCES_CHANGED } from '@/state';
import { PANEL_NAME_TAGS } from '@/controllers/constants';
import { PREF_TAGS_PANEL_WIDTH } from '@/services/preferencesManager';
import { STRING_DELETE_TAG } from '@/strings';

class TagsPanelCtrl {
  /* @ngInject */
  constructor(
    $rootScope,
    $timeout,
    modelManager,
    syncManager,
    componentManager,
    appState,
    alertManager,
    preferencesManager
  ) {
    this.componentManager = componentManager;
    this.modelManager = modelManager;
    this.syncManager = syncManager;
    this.appState = appState;
    this.alertManager = alertManager;
    this.preferencesManager = preferencesManager;
    this.$rootScope = $rootScope;
    this.$timeout = $timeout;
    this.panelController = {};
    $timeout(() => {
      this.selectDefaultTag();
    })
    this.addSyncEventHandler();
    this.addAppStateObserver();
    this.addMappingObserver();
    this.loadPreferences();
    this.registerComponentHandler();
  }

  addSyncEventHandler() {
    this.syncManager.addEventHandler((syncEvent, data) => {
      if(
        syncEvent === 'local-data-loaded' ||
        syncEvent === 'sync:completed' ||
        syncEvent === 'local-data-incremental-load'
      ) {
        this.tags = this.modelManager.tags;
        this.smartTags = this.modelManager.getSmartTags();
      }
    });
  }

  addAppStateObserver() {
    this.appState.addObserver((eventName, data) => {
      if(eventName === APP_STATE_EVENT_PREFERENCES_CHANGED) {
        this.loadPreferences();
      }
    })
  }

  addMappingObserver() {
    this.modelManager.addItemSyncObserver(
      'tags-list-tags',
      'Tag',
      (allItems, validItems, deletedItems, source, sourceKey) => {
        this.reloadNoteCounts();

        if(!this.selectedTag) {
          return;
        }
        /** If the selected tag has been deleted, revert to All view. */
        const selectedTag = allItems.find((tag) => {
          return tag.uuid === this.selectedTag.uuid
        });
        if(selectedTag && selectedTag.deleted) {
          this.selectTag(this.smartTags[0]);
        }
      }
    );
  }

  reloadNoteCounts() {
    let allTags = [];
    if(this.tags) { allTags = allTags.concat(this.tags);}
    if(this.smartTags) { allTags = allTags.concat(this.smartTags);}

    for(const tag of allTags) {
      const validNotes = SNNote.filterDummyNotes(tag.notes).filter((note) => {
        return !note.archived && !note.content.trashed;
      });
      tag.cachedNoteCount = validNotes.length;
    }
  }

  loadPreferences() {
    const width = this.preferencesManager.getValue(PREF_TAGS_PANEL_WIDTH);
    if(width) {
      this.panelController.setWidth(width);
      if(this.panelController.isCollapsed()) {
        appState.panelDidResize({
          name: PANEL_NAME_TAGS,
          collapsed: this.panelController.isCollapsed()
        })
      }
    }
  }

  onPanelResize = (newWidth, lastLeft, isAtMaxWidth, isCollapsed) => {
    this.preferencesManager.setUserPrefValue(
      PREF_TAGS_PANEL_WIDTH,
      newWidth,
      true
    );
    this.appState.panelDidResize({
      name: PANEL_NAME_TAGS,
      collapsed: isCollapsed
    });
  }

  registerComponentHandler() {
    this.componentManager.registerHandler({
      identifier: 'tags',
      areas: ['tags-list'],
      activationHandler: (component) => {
        this.component = component;
      },
      contextRequestHandler: (component) => {
        return null;
      },
      actionHandler: (component, action, data) => {
        if(action === 'select-item') {
          if(data.item.content_type === 'Tag') {
            let tag = this.modelManager.findItem(data.item.uuid);
            if(tag) {
              this.selectTag(tag);
            }
          } else if(data.item.content_type === 'SN|SmartTag') {
            let smartTag = new SNSmartTag(data.item);
            this.selectTag(smartTag);
          }
        } else if(action === 'clear-selection') {
          this.selectTag(this.smartTags[0]);
        }
      }
    });
  }

  selectTag(tag) {
    if(tag.isSmartTag()) {
      Object.defineProperty(tag, 'notes', {
        get: () => {
          return this.modelManager.notesMatchingSmartTag(tag);
        }
      });
    }
    this.selectedTag = tag;
    if(tag.content.conflict_of) {
      tag.content.conflict_of = null;
      this.modelManager.setItemDirty(tag);
      this.syncManager.sync();
    }

    this.appState.setSelectedTag(tag);
  }

  clickedAddNewTag() {
    if(this.editingTag) {
      return;
    }
    this.newTag = this.modelManager.createItem({
      content_type: 'Tag'
    });
    this.selectedTag = this.newTag;
    this.editingTag = this.newTag;
    this.modelManager.addItem(this.newTag);
  }

  tagTitleDidChange(tag) {
    this.editingTag = tag;
  }

  saveTag($event, tag) {
    $event.target.blur();
    this.editingTag = null;
    if(!tag.title || tag.title.length === 0) {
      if(this.editingOriginalName) {
        tag.title = this.editingOriginalName;
        this.editingOriginalName = null;
      } else {
        /** Newly created tag without content */
        this.modelManager.removeItemLocally(tag);
      }
      return;
    }

    if(!tag.title || tag.title.length === 0) {
      this.removeTag(tag);
      return;
    }

    this.modelManager.setItemDirty(tag);
    this.syncManager.sync();
    this.modelManager.resortTag(tag);
    this.selectTag(tag);
    this.newTag = null;
  }

  selectedRenameTag($event, tag) {
    this.editingOriginalName = tag.title;
    this.editingTag = tag;
    $timeout(() => {
      document.getElementById('tag-' + tag.uuid).focus()
    })
  }

  selectedDeleteTag(tag) {
    this.removeTag(tag);
    this.selectTag(this.smartTags[0]);
  }

  removeTag(tag) {
    this.alertManager.confirm({
      text: STRING_DELETE_TAG,
      destructive: true,
      onConfirm: () => {
        this.modelManager.setItemToBeDeleted(tag);
        this.syncManager.sync().then(() => {
          this.$rootScope.safeApply();
        });
      }
    });
  }

  selectDefaultTag() {
    this.smartTags = this.modelManager.getSmartTags();
    this.selectTag(this.smartTags[0]);
  }
}

export class TagsPanel {
  constructor() {
    this.restrict = 'E';
    this.scope = {};
    this.template = template;
    this.replace = true;
    this.controller = TagsPanelCtrl;
    this.controllerAs = 'ctrl';
    this.bindToController = true;
  }
}
