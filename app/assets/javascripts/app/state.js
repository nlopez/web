export const APP_STATE_EVENT_TAG_CHANGED = 1;
export const APP_STATE_EVENT_NOTE_CHANGED = 2;

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

}
