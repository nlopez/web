import template from '%/directives/actions-menu.pug';

class ActionsMenuCtrl {
  /* @ngInject */
  constructor(actionsManager) {
    this.actionsManager = actionsManager;
  }

  $onInit() {
    this.loadExtensions();
  };

  loadExtensions() {
    this.extensions = this.actionsManager.extensions.sort((a, b) => {
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
    for(const extension of this.extensions) {
      extension.loading = true;
      this.actionsManager.loadExtensionInContextOfItem(
        extension,
        this.item,
        (scopedExtension) => {
          extension.loading = false;
        }
      )
    }
  }

  executeAction(action, extension, parentAction) {
    if(action.verb === 'nested') {
      if(!action.subrows) {
        action.subrows = this.subRowsForAction(action, extension);
      } else {
        action.subrows = null;
      }
      return;
    }

    action.running = true;
    this.actionsManager.executeAction(
      action,
      extension,
      this.item,
      (response, error) => {
        if(error) {
          return;
        }
        action.running = false;
        this.handleActionResponse(action, response);
        this.actionsManager.loadExtensionInContextOfItem(
          extension,
          this.item
        );
      }
    )
  }

  handleActionResponse(action, response) {
    switch (action.verb) {
      case 'render': {
        const item = response.item;
        this.actionsManager.presentRevisionPreviewModal(
          item.uuid,
          item.content
        );
      }
    }
  }

  subRowsForAction(parentAction, extension) {
    if(!parentAction.subactions) {
      return null;
    }
    return parentAction.subactions.map((subaction) => {
      return {
        onClick: () => {
          this.executeAction(subaction, extension, parentAction);
        },
        label: subaction.label,
        subtitle: subaction.desc,
        spinnerClass: subaction.running ? 'info' : null
      }
    })
  }
}

export class ActionsMenu {
  constructor() {
    this.restrict = 'E';
    this.scope = {
      item: '='
    };
    this.template = template;
    this.replace = true;
    this.controller = ActionsMenuCtrl;
    this.controllerAs = 'ctrl';
    this.bindToController = true;
  }
}
