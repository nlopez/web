import { isDesktopApplication } from '@/utils';
import template from '%/directives/editor-menu.pug';

class EditorMenuCtrl {
  /* @ngInject */
  constructor(
    $timeout,
    componentManager,
    modelManager,
    syncManager,
  ) {
    this.$timeout = $timeout;
    this.componentManager = componentManager;
    this.modelManager = modelManager;
    this.syncManager = syncManager;
    this.formData = {};
    this.isDesktop = isDesktopApplication();
  }

  $onInit() {
    this.editors = this.componentManager.componentsForArea('editor-editor')
    .sort((a, b) => {
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
    this.defaultEditor = this.editors.filter((e) => e.isDefaultEditor())[0];
  };

  selectComponent(component) {
    if(component) {
      if(component.content.conflict_of) {
        component.content.conflict_of = null;
        this.modelManager.setItemDirty(component, true);
        this.syncManager.sync();
      }
    }
    this.$timeout(() => {
      this.callback()(component);
    })
  }

  toggleDefaultForEditor(editor) {
    if(this.defaultEditor === editor) {
      this.removeEditorDefault(editor);
    } else {
      this.makeEditorDefault(editor);
    }
  }

  offlineAvailableForComponent(component) {
    return component.local_url && isDesktopApplication();
  }

  makeEditorDefault(component) {
    const currentDefault = this.componentManager
      .componentsForArea('editor-editor')
      .filter((e) => e.isDefaultEditor())[0];
    if(currentDefault) {
      currentDefault.setAppDataItem('defaultEditor', false);
      this.modelManager.setItemDirty(currentDefault);
    }
    component.setAppDataItem('defaultEditor', true);
    this.modelManager.setItemDirty(component);
    this.syncManager.sync();
    this.defaultEditor = component;
  }

  removeEditorDefault(component) {
    component.setAppDataItem('defaultEditor', false);
    this.modelManager.setItemDirty(component);
    this.syncManager.sync();
    this.defaultEditor = null;
  }

  shouldDisplayRunningLocallyLabel(component) {
    if(!component.runningLocally) {
      return false;
    }
    if(component === this.selectedEditor) {
      return true;
    } else {
      return false;
    }
  }
}

export class EditorMenu {
  constructor() {
    this.restrict = 'E';
    this.template = template;
    this.controller = EditorMenuCtrl;
    this.controllerAs = 'ctrl';
    this.bindToController = true;
    this.scope = {
      callback: '&',
      selectedEditor: '=',
      currentItem: '='
    };
  }
}
