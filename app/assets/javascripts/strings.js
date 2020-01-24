export const STRING_SESSION_EXPIRED         = "Your session has expired. New changes will not be pulled in. Please sign out and sign back in to refresh your session.";
export const STRING_DEFAULT_FILE_ERROR      = "Please use FileSafe or the Bold Editor to attach images and files. Learn more at standardnotes.org/filesafe.";


export function StringSyncException(data) {
  return `There was an error while trying to save your items. Please contact support and share this message: ${data}.`
}
