import { SNNote, SNSmartTag } from 'snjs';
import template from '%/tags.pug';
import { APP_STATE_EVENT_PREFERENCES_CHANGED } from '@/state';
import { PANEL_NAME_TAGS } from '@/controllers/constants';
import { PREF_TAGS_PANEL_WIDTH } from '@/services/preferencesManager';
import { STRING_DELETE_TAG } from '@/strings';
import { PureCtrl } from '@Controllers';

class TagsPanelCtrl extends PureCtrl {
  /* @ngInject */
  constructor(
    $rootScope,
    $timeout,
    alertManager,
    appState,
    componentManager,
    modelManager,
    preferencesManager,
    syncManager,
  ) {
    super($timeout);
    this.$rootScope = $rootScope;
    this.alertManager = alertManager;
    this.appState = appState;
    this.componentManager = componentManager;
    this.modelManager = modelManager;
    this.preferencesManager = preferencesManager;
    this.syncManager = syncManager;
    this.panelController = {};
    this.addSyncEventHandler();
    this.addAppStateObserver();
    this.addMappingObserver();
    this.loadPreferences();
    this.registerComponentHandler();
    this.state = {
      smartTags: this.modelManager.getSmartTags()
    }
  }
  
  $onInit() {
    this.selectTag(this.state.smartTags[0]);
  }

  addSyncEventHandler() {
    this.syncManager.addEventHandler((syncEvent, data) => {
      if (
        syncEvent === 'local-data-loaded' ||
        syncEvent === 'sync:completed' ||
        syncEvent === 'local-data-incremental-load'
      ) {
        this.setState({
          tags: this.modelManager.tags,
          smartTags: this.modelManager.getSmartTags()
        })
      }
    });
  }

  addAppStateObserver() {
    this.appState.addObserver((eventName, data) => {
      if (eventName === APP_STATE_EVENT_PREFERENCES_CHANGED) {
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

        if (!this.state.selectedTag) {
          return;
        }
        /** If the selected tag has been deleted, revert to All view. */
        const selectedTag = allItems.find((tag) => {
          return tag.uuid === this.state.selectedTag.uuid
        });
        if (selectedTag && selectedTag.deleted) {
          this.selectTag(this.state.smartTags[0]);
        }
      }
    );
  }

  reloadNoteCounts() {
    let allTags = [];
    if (this.state.tags) { allTags = allTags.concat(this.state.tags); }
    if (this.state.smartTags) { allTags = allTags.concat(this.state.smartTags); }

    for (const tag of allTags) {
      const validNotes = SNNote.filterDummyNotes(tag.notes).filter((note) => {
        return !note.archived && !note.content.trashed;
      });
      tag.cachedNoteCount = validNotes.length;
    }
  }

  loadPreferences() {
    const width = this.preferencesManager.getValue(PREF_TAGS_PANEL_WIDTH);
    if (width) {
      this.panelController.setWidth(width);
      if (this.panelController.isCollapsed()) {
        this.appState.panelDidResize({
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
        if (action === 'select-item') {
          if (data.item.content_type === 'Tag') {
            const tag = this.modelManager.findItem(data.item.uuid);
            if (tag) {
              this.selectTag(tag);
            }
          } else if (data.item.content_type === 'SN|SmartTag') {
            const smartTag = new SNSmartTag(data.item);
            this.selectTag(smartTag);
          }
        } else if (action === 'clear-selection') {
          this.selectTag(this.state.smartTags[0]);
        }
      }
    });
  }

  async selectTag(tag) {
    if (tag.isSmartTag()) {
      Object.defineProperty(tag, 'notes', {
        get: () => {
          return this.modelManager.notesMatchingSmartTag(tag);
        }
      });
    }
    if (tag.content.conflict_of) {
      tag.content.conflict_of = null;
      this.modelManager.setItemDirty(tag);
      this.syncManager.sync();
    }
    this.setState({
      selectedTag: tag
    })
    this.appState.setSelectedTag(tag);
  }

  clickedAddNewTag() {
    if (this.state.editingTag) {
      return;
    }
    const newTag = this.modelManager.createItem({
      content_type: 'Tag'
    });
    this.setState({
      selectedTag: newTag,
      editingTag: newTag,
      newTag: newTag
    })
    this.modelManager.addItem(newTag);
  }

  tagTitleDidChange(tag) {
    this.setState({
      editingTag: tag
    })
  }

  saveTag($event, tag) {
    $event.target.blur();
    this.setState({
      editingTag: null
    })
    if (!tag.title || tag.title.length === 0) {
      if (this.editingOriginalName) {
        tag.title = this.editingOriginalName;
        this.editingOriginalName = null;
      } else {
        /** Newly created tag without content */
        this.modelManager.removeItemLocally(tag);
      }
      return;
    }

    if (!tag.title || tag.title.length === 0) {
      this.removeTag(tag);
      return;
    }

    this.modelManager.setItemDirty(tag);
    this.syncManager.sync();
    this.modelManager.resortTag(tag);
    this.selectTag(tag);
    this.setState({
      newTag: null
    })
  }

  selectedRenameTag($event, tag) {
    this.editingOriginalName = tag.title;
    this.setState({
      editingTag: tag
    })
    this.$timeout(() => {
      document.getElementById('tag-' + tag.uuid).focus()
    })
  }

  selectedDeleteTag(tag) {
    this.removeTag(tag);
    this.selectTag(this.state.smartTags[0]);
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
}

export class TagsPanel {
  constructor() {
    this.restrict = 'E';
    this.scope = {};
    this.template = template;
    this.replace = true;
    this.controller = TagsPanelCtrl;
    this.controllerAs = 'self';
    this.bindToController = true;
  }
}
