export const APP_STATE_EVENT_TAG_CHANGED                 = 1;
export const APP_STATE_EVENT_NOTE_CHANGED                = 2;
export const APP_STATE_EVENT_PREFERENCES_CHANGED         = 3;
export const APP_STATE_EVENT_PANEL_RESIZED               = 4;
export const APP_STATE_EVENT_EDITOR_FOCUSED              = 5;
export const APP_STATE_EVENT_BEGAN_BACKUP_DOWNLOAD       = 6;
export const APP_STATE_EVENT_ENDED_BACKUP_DOWNLOAD       = 7;
export const APP_STATE_EVENT_DESKTOP_EXTS_READY          = 8;

export class AppState {

  constructor() {
    this.observers = [];
  }

  addObserver(callback) {
    this.observers.push(callback);
    return callback;
  }

  notifyEvent(eventName, data) {
    for(const callback of this.observers) {
      callback(eventName, data);
    }
  }

  setSelectedTag(tag) {
    if(this.selectedTag === tag) {
      return;
    }
    const previousTag = this.selectedTag;
    this.selectedTag = tag;
    this.notifyEvent(
      APP_STATE_EVENT_TAG_CHANGED,
      {previousTag: previousTag}
    );
  }

  setSelectedNote(note) {
    const previousNote = this.selectedNote;
    this.selectedNote = note;
    this.notifyEvent(
      APP_STATE_EVENT_NOTE_CHANGED,
      {previousNote: previousNote}
    );
  }

  getSelectedTag() {
    return this.selectedTag;
  }

  getSelectedNote() {
    return this.selectedNote;
  }

  setUserPreferences(preferences) {
    this.notifyEvent(
      APP_STATE_EVENT_PREFERENCES_CHANGED
    );
  }

  panelDidResize({name, collapsed}) {
    this.notifyEvent(
      APP_STATE_EVENT_PANEL_RESIZED,
      {
        panel: name,
        collapsed: collapsed
      }
    )
  }

  editorDidFocus() {
    this.notifyEvent(
      APP_STATE_EVENT_EDITOR_FOCUSED
    );
  }

  beganBackupDownload() {
    this.notifyEvent(
      APP_STATE_EVENT_BEGAN_BACKUP_DOWNLOAD
    );
  }

  endedBackupDownload({success}) {
    this.notifyEvent(
      APP_STATE_EVENT_ENDED_BACKUP_DOWNLOAD,
      {success: success}
    );
  }

  /**
   * When the desktop appplication extension server is ready.
   */
  desktopExtensionsReady() {
    this.notifyEvent(
      APP_STATE_EVENT_DESKTOP_EXTS_READY
    );
  }

}
