/** @generic */
export const STRING_SESSION_EXPIRED         = "Your session has expired. New changes will not be pulled in. Please sign out and sign back in to refresh your session.";
export const STRING_DEFAULT_FILE_ERROR      = "Please use FileSafe or the Bold Editor to attach images and files. Learn more at standardnotes.org/filesafe.";
export function StringSyncException(data) {
  return `There was an error while trying to save your items. Please contact support and share this message: ${data}.`
}


/** @tags */
export const STRING_DELETE_TAG              = "Are you sure you want to delete this tag? Note: deleting a tag will not delete its notes.";

/** @editor */
export const STRING_DELETED_NOTE               = "The note you are attempting to edit has been deleted, and is awaiting sync. Changes you make will be disregarded.";
export const STRING_INVALID_NOTE               = "The note you are attempting to save can not be found or has been deleted. Changes you make will not be synced. Please copy this note's text and start a new note.";
export const STRING_ELLIPSES                   = "...";
export const STRING_GENERIC_SAVE_ERROR         = "There was an error saving your note. Please try again.";
export const STRING_DELETE_PLACEHOLDER_ATTEMPT = "This note is a placeholder and cannot be deleted. To remove from your list, simply navigate to a different note.";
export const STRING_DELETE_LOCKED_ATTEMPT      = "This note is locked. If you'd like to delete it, unlock it, and try again.";
export function StringDeleteNote({title, permanently}) {
  return permanently
    ? `Are you sure you want to permanently delete ${title}?`
    : `Are you sure you want to move ${title} to the trash?`;
}
export function StringEmptyTrash({count}) {
  return `Are you sure you want to permanently delete ${count} note(s)?`;
}
