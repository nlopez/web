import _ from 'lodash';
import { SFAuthManager } from 'snjs';
import { getPlatformString } from '@/utils';
import template from '%/root.pug';
import {
  APP_STATE_EVENT_PANEL_RESIZED
} from '@/state';
import {
  PANEL_NAME_NOTES,
  PANEL_NAME_TAGS
} from '@/controllers/constants';

export class Root {
  constructor() {
    this.template = template;
  }

  /* @ngInject */
  controller(
    $scope,
    $location,
    $rootScope,
    $timeout,
    modelManager,
    dbManager,
    syncManager,
    authManager,
    themeManager,
    passcodeManager,
    storageManager,
    migrationManager,
    privilegesManager,
    statusManager,
    alertManager,
    preferencesManager,
    appState
  ) {
    storageManager.initialize(passcodeManager.hasPasscode(), authManager.isEphemeralSession());
    $scope.platform = getPlatformString();
    $scope.onUpdateAvailable = function() {
      $rootScope.$broadcast('new-update-available');
    }

    appState.addObserver((eventName, data) => {
      if(eventName === APP_STATE_EVENT_PANEL_RESIZED) {
        if(data.panel === PANEL_NAME_NOTES) {
          this.notesCollapsed = data.collapsed;
        }
        if(data.panel === PANEL_NAME_TAGS) {
          this.tagsCollapsed = data.collapsed;
        }
        let appClass = "";
        if(this.notesCollapsed) { appClass += "collapsed-notes"; }
        if(this.tagsCollapsed) { appClass += " collapsed-tags"; }
        $scope.appClass = appClass;
      }
    })

    /* Used to avoid circular dependencies where syncManager cannot be imported but rootScope can */
    $rootScope.sync = function(source) {
      syncManager.sync();
    }

    $rootScope.lockApplication = function() {
      // Reloading wipes current objects from memory
      window.location.reload();
    }

    const initiateSync = () => {
      authManager.loadInitialData();
      preferencesManager.load();

      this.syncStatusObserver = syncManager.registerSyncStatusObserver((status) => {
        if(status.retrievedCount > 20) {
          var text = `Downloading ${status.retrievedCount} items. Keep app open.`
          this.syncStatus = statusManager.replaceStatusWithString(this.syncStatus, text);
          this.showingDownloadStatus = true;
        } else if(this.showingDownloadStatus) {
          this.showingDownloadStatus = false;
          var text = "Download Complete.";
          this.syncStatus = statusManager.replaceStatusWithString(this.syncStatus, text);
          setTimeout(() => {
            this.syncStatus = statusManager.removeStatus(this.syncStatus);
          }, 2000);
        } else if(status.total > 20) {
          this.uploadSyncStatus = statusManager.replaceStatusWithString(this.uploadSyncStatus, `Syncing ${status.current}/${status.total} items...`)
        } else if(this.uploadSyncStatus) {
          this.uploadSyncStatus = statusManager.removeStatus(this.uploadSyncStatus);
        }
      })

      syncManager.setKeyRequestHandler(async () => {
        let offline = authManager.offline();
        let auth_params = offline ? passcodeManager.passcodeAuthParams() : await authManager.getAuthParams();
        let keys = offline ? passcodeManager.keys() : await authManager.keys();
        return {
          keys: keys,
          offline: offline,
          auth_params: auth_params
        }
      });

      let lastSessionInvalidAlert;

      syncManager.addEventHandler((syncEvent, data) => {
        $rootScope.$broadcast(syncEvent, data || {});
        if(syncEvent == "sync-session-invalid") {
          // On Windows, some users experience issues where this message keeps appearing. It might be that on focus, the app syncs, and this message triggers again.
          // We'll only show it once every X seconds
          let showInterval = 30; // At most 30 seconds in between
          if(!lastSessionInvalidAlert || (new Date() - lastSessionInvalidAlert)/1000 > showInterval) {
            lastSessionInvalidAlert = new Date();
            setTimeout(function () {
              // If this alert is displayed on launch, it may sometimes dismiss automatically really quicky for some reason. So we wrap in timeout
              alertManager.alert({text: "Your session has expired. New changes will not be pulled in. Please sign out and sign back in to refresh your session."});
            }, 500);
          }
        } else if(syncEvent == "sync-exception") {
          alertManager.alert({text: `There was an error while trying to save your items. Please contact support and share this message: ${data}`});
        }
      });

      let encryptionEnabled = authManager.user || passcodeManager.hasPasscode();
      this.syncStatus = statusManager.addStatusFromString(encryptionEnabled ? "Decrypting items..." : "Loading items...");

      let incrementalCallback = (current, total) => {
        let notesString = `${current}/${total} items...`
        this.syncStatus = statusManager.replaceStatusWithString(this.syncStatus, encryptionEnabled ? `Decrypting ${notesString}` : `Loading ${notesString}`);
      }

      syncManager.loadLocalItems({incrementalCallback}).then(() => {
        $timeout(() => {
          $rootScope.$broadcast("initial-data-loaded"); // This needs to be processed first before sync is called so that singletonManager observers function properly.
          // Perform integrity check on first sync
          this.syncStatus = statusManager.replaceStatusWithString(this.syncStatus, "Syncing...");
          syncManager.sync({performIntegrityCheck: true}).then(() => {
            this.syncStatus = statusManager.removeStatus(this.syncStatus);
          })
          // refresh every 30s
          setInterval(function () {
            syncManager.sync();
          }, 30000);
        })
      });

      authManager.addEventHandler((event) => {
        if(event == SFAuthManager.DidSignOutEvent) {
          modelManager.handleSignout();
          syncManager.handleSignout();
        }
      })
    }

    function load() {
      openDatabase();
      initiateSync();
    }

    if(passcodeManager.isLocked()) {
      $scope.needsUnlock = true;
    } else {
      load();
    }

    $scope.onSuccessfulUnlock = function() {
      $timeout(() => {
        $scope.needsUnlock = false;
        load();
      })
    }

    function openDatabase() {
      dbManager.setLocked(false);
      dbManager.openDatabase({
        onUpgradeNeeded: () => {
          // new database, delete syncToken so that items can be refetched entirely from server
          syncManager.clearSyncToken();
          syncManager.sync();
        }
      })
    }

    /*
    Shared Callbacks
    */

    $rootScope.safeApply = function(fn) {
      var phase = this.$root.$$phase;
      if(phase == '$apply' || phase == '$digest')
      this.$eval(fn);
      else
      this.$apply(fn);
    };

    /*
    Disable dragging and dropping of files into main SN interface.
    both 'dragover' and 'drop' are required to prevent dropping of files.
    This will not prevent extensions from receiving drop events.
    */
    window.addEventListener('dragover', (event) => {
      event.preventDefault();
    }, false)

    window.addEventListener('drop', (event) => {
      event.preventDefault();
      alertManager.alert({text: "Please use FileSafe or the Bold Editor to attach images and files. Learn more at standardnotes.org/filesafe."})
    }, false)


    /*
    Handle Auto Sign In From URL
    */

    function urlParam(key) {
      return $location.search()[key];
    }

    async function autoSignInFromParams() {
      var server = urlParam("server");
      var email = urlParam("email");
      var pw = urlParam("pw");

      if(!authManager.offline()) {
        // check if current account
        if(await syncManager.getServerURL() === server && authManager.user.email === email) {
          // already signed in, return
          return;
        } else {
          // sign out
          authManager.signout(true).then(() => {
            window.location.reload();
          });
        }
      } else {
        authManager.login(server, email, pw, false, false, {}).then((response) => {
          window.location.reload();
        })
      }
    }

    if(urlParam("server")) {
      autoSignInFromParams();
    }
  }
}
