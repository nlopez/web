import template from '%/directives/actions-menu.pug';

class ActionsMenuCtrl {
  /* @ngInject */
  constructor(actionsManager) {
    this.actionsManager = actionsManager;
  }

  $onInit() {
    this.loadExtensions();
  };

  async loadExtensions() {
    this.extensions = this.actionsManager.extensions.sort((a, b) => {
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
    for (const extension of this.extensions) {
      extension.loading = true;
      await this.actionsManager.loadExtensionInContextOfItem(
        extension,
        this.item
      )
      extension.loading = false;
    }
  }

  async executeAction(action, extension) {
    if (action.verb === 'nested') {
      if (!action.subrows) {
        action.subrows = this.subRowsForAction(action, extension);
      } else {
        action.subrows = null;
      }
      return;
    }
    action.running = true;
    const result = await this.actionsManager.executeAction(
      action,
      extension,
      this.item
    );
    if (action.error) {
      return;
    }
    action.running = false;
    this.handleActionResult(action, result);
    await this.actionsManager.loadExtensionInContextOfItem(
      extension,
      this.item
    );
  }

  handleActionResult(action, result) {
    switch (action.verb) {
      case 'render': {
        const item = result.item;
        this.actionsManager.presentRevisionPreviewModal(
          item.uuid,
          item.content
        );
      }
    }
  }

  subRowsForAction(parentAction, extension) {
    if (!parentAction.subactions) {
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
