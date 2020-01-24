import { SNNote, SNSmartTag } from 'snjs';
import template from '%/tags.pug';
import {
  APP_STATE_EVENT_PREFERENCES_CHANGED
} from '@/state';
import {
  PANEL_NAME_TAGS
} from '@/controllers/constants';
import {
  PREF_TAGS_PANEL_WIDTH
} from '@/services/preferencesManager';

export class TagsPanel {
  constructor() {
    this.restrict = 'E';
    this.scope = {};
    this.template = template;
    this.replace = true;
    this.controllerAs = 'ctrl';
    this.bindToController = true;
  }

  /* @ngInject */
  controller(
    $rootScope,
    modelManager,
    syncManager,
    $timeout,
    componentManager,
    authManager,
    appState,
    alertManager,
    preferencesManager
  ) {
    // Wrap in timeout so that selectTag is defined
    $timeout(() => {
      this.smartTags = modelManager.getSmartTags();
      this.selectTag(this.smartTags[0]);
    })

    syncManager.addEventHandler((syncEvent, data) => {
      if(
        syncEvent === 'local-data-loaded' ||
        syncEvent === 'sync:completed' ||
        syncEvent === 'local-data-incremental-load'
      ) {
        this.tags = modelManager.tags;
        this.smartTags = modelManager.getSmartTags();
      }
    });

    appState.addObserver((eventName, data) => {
      if(eventName === APP_STATE_EVENT_PREFERENCES_CHANGED) {
        this.loadPreferences();
      }
    })

    modelManager.addItemSyncObserver(
      'tags-list',
      '*',
      (allItems, validItems, deletedItems, source, sourceKey) => {
        this.reloadNoteCounts();
      }
    );

    modelManager.addItemSyncObserver(
      'tags-list-tags',
      'Tag',
      (allItems, validItems, deletedItems, source, sourceKey) => {
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

    this.reloadNoteCounts = function() {
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

    this.panelController = {};

    this.loadPreferences = function() {
      let width = preferencesManager.getValue(PREF_TAGS_PANEL_WIDTH);
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

    this.loadPreferences();

    this.onPanelResize = function(newWidth, lastLeft, isAtMaxWidth, isCollapsed) {
      preferencesManager.setUserPrefValue(PREF_TAGS_PANEL_WIDTH, newWidth, true);
      appState.panelDidResize({
        name: PANEL_NAME_TAGS,
        collapsed: isCollapsed
      });
    }

    this.componentManager = componentManager;

    componentManager.registerHandler({
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
            let tag = modelManager.findItem(data.item.uuid);
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

    this.selectTag = function(tag) {
      if(tag.isSmartTag()) {
        Object.defineProperty(tag, 'notes', {
          get: () => {
            return modelManager.notesMatchingSmartTag(tag);
          }
        });
      }
      this.selectedTag = tag;
      if(tag.content.conflict_of) {
        tag.content.conflict_of = null;
        modelManager.setItemDirty(tag, true);
        syncManager.sync();
      }

      appState.setSelectedTag(tag);
    }

    this.clickedAddNewTag = function() {
      if(this.editingTag) {
        return;
      }
      this.newTag = modelManager.createItem({
        content_type: 'Tag'
      });
      this.selectedTag = this.newTag;
      this.editingTag = this.newTag;
      modelManager.addItem(this.newTag);
    }

    this.tagTitleDidChange = function(tag) {
      this.editingTag = tag;
    }

    this.saveTag = function($event, tag) {
      this.editingTag = null;
      $event.target.blur();

      if(!tag.title || tag.title.length == 0) {
        if(originalTagName) {
          tag.title = originalTagName;
          originalTagName = null;
        } else {
          // newly created tag without content
          modelManager.removeItemLocally(tag);
        }
        return;
      }

      if(!tag.title || tag.title.length == 0) {
        this.removeTag(tag);
        return;
      }

      modelManager.setItemDirty(tag, true);
      syncManager.sync().then();
      modelManager.resortTag(tag);
      this.selectTag(tag);
      this.newTag = null;
    }

    this.removeTag = function(tag) {
      alertManager.confirm({
        text: "Are you sure you want to delete this tag? Note: deleting a tag will not delete its notes.",
        destructive: true,
        onConfirm: () => {
          modelManager.setItemToBeDeleted(tag);
          syncManager.sync().then(() => {
            // force scope tags to update on sub directives
            $rootScope.safeApply();
          });
        }
      });
    }

    function inputElementForTag(tag) {
      return document.getElementById('tag-' + tag.uuid);
    }

    let originalTagName = '';
    this.selectedRenameTag = function($event, tag) {
      originalTagName = tag.title;
      this.editingTag = tag;
      $timeout(function(){
        inputElementForTag(tag).focus();
      })
    }

    this.selectedDeleteTag = function(tag) {
      this.removeTag(tag);
      this.selectTag(this.smartTags[0]);
    }
  }
}
