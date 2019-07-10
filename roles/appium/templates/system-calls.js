"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "DEFAULT_ADB_EXEC_TIMEOUT", {
  enumerable: true,
  get: function get() {
    return _helpers.DEFAULT_ADB_EXEC_TIMEOUT;
  }
});
exports.default = void 0;

var _asyncToGenerator2 = _interopRequireDefault(require("@babel/runtime/helpers/asyncToGenerator"));

var _path = _interopRequireDefault(require("path"));

var _logger = _interopRequireDefault(require("../logger.js"));

var _bluebird = _interopRequireDefault(require("bluebird"));

var _appiumSupport = require("appium-support");

var _helpers = require("../helpers");

var _teen_process = require("teen_process");

var _asyncbox = require("asyncbox");

var _lodash = _interopRequireDefault(require("lodash"));

var _shellQuote = require("shell-quote");

let systemCallMethods = {};
const DEFAULT_ADB_REBOOT_RETRIES = 90;
const LINKER_WARNING_REGEXP = /^WARNING: linker.+$/m;
const PROTOCOL_FAULT_ERROR_REGEXP = new RegExp('protocol fault \\(no status\\)', 'i');
const DEVICE_NOT_FOUND_ERROR_REGEXP = new RegExp(`error: device ('.+' )?not found`, 'i');
const DEVICE_CONNECTING_ERROR_REGEXP = new RegExp('error: device still connecting', 'i');
const CERTS_ROOT = '/system/etc/security/cacerts';

systemCallMethods.getSdkBinaryPath = function () {
  var _getSdkBinaryPath = (0, _asyncToGenerator2.default)(function* (binaryName) {
    if (this.sdkRoot) {
      return yield this.getBinaryFromSdkRoot(binaryName);
    }

    _logger.default.warn(`The ANDROID_HOME environment variable is not set to the Android SDK ` + `root directory path. ANDROID_HOME is required for compatibility ` + `with SDK 23+. Checking along PATH for ${binaryName}.`);

    return yield this.getBinaryFromPath(binaryName);
  });

  return function getSdkBinaryPath(_x) {
    return _getSdkBinaryPath.apply(this, arguments);
  };
}();

systemCallMethods.getBinaryNameForOS = _lodash.default.memoize(function getBinaryNameForOS(binaryName) {
  if (!_appiumSupport.system.isWindows()) {
    return binaryName;
  }

  if (['android', 'apksigner', 'apkanalyzer'].includes(binaryName)) {
    return `${binaryName}.bat`;
  }

  if (!_path.default.extname(binaryName)) {
    return `${binaryName}.exe`;
  }

  return binaryName;
});

systemCallMethods.getBinaryFromSdkRoot = function () {
  var _getBinaryFromSdkRoot = (0, _asyncToGenerator2.default)(function* (binaryName) {
    if (this.binaries[binaryName]) {
      return this.binaries[binaryName];
    }

    const fullBinaryName = this.getBinaryNameForOS(binaryName);
    const binaryLocs = ['platform-tools', 'emulator', 'tools', `tools${_path.default.sep}bin`].map(x => _path.default.resolve(this.sdkRoot, x, fullBinaryName));
    let buildToolsDirs = yield (0, _helpers.getBuildToolsDirs)(this.sdkRoot);

    if (this.buildToolsVersion) {
      buildToolsDirs = buildToolsDirs.filter(x => _path.default.basename(x) === this.buildToolsVersion);

      if (_lodash.default.isEmpty(buildToolsDirs)) {
        _logger.default.info(`Found no build tools whose version matches to '${this.buildToolsVersion}'`);
      } else {
        _logger.default.info(`Using build tools at '${buildToolsDirs}'`);
      }
    }

    binaryLocs.push(...buildToolsDirs.map(dir => _path.default.resolve(dir, fullBinaryName)));
    let binaryLoc = null;
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (var _iterator = binaryLocs[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
        const loc = _step.value;

        if (yield _appiumSupport.fs.exists(loc)) {
          binaryLoc = loc;
          break;
        }
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion && _iterator.return != null) {
          _iterator.return();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }

    if (_lodash.default.isNull(binaryLoc)) {
      throw new Error(`Could not find '${fullBinaryName}' in ${JSON.stringify(binaryLocs)}. ` + `Do you have Android Build Tools ${this.buildToolsVersion ? `v ${this.buildToolsVersion} ` : ''}` + `installed at '${this.sdkRoot}'?`);
    }

    _logger.default.info(`Using '${fullBinaryName}' from '${binaryLoc}'`);

    this.binaries[binaryName] = binaryLoc;
    return binaryLoc;
  });

  return function getBinaryFromSdkRoot(_x2) {
    return _getBinaryFromSdkRoot.apply(this, arguments);
  };
}();

systemCallMethods.getBinaryFromPath = function () {
  var _getBinaryFromPath = (0, _asyncToGenerator2.default)(function* (binaryName) {
    if (this.binaries[binaryName]) {
      return this.binaries[binaryName];
    }

    const fullBinaryName = this.getBinaryNameForOS(binaryName);

    try {
      const binaryLoc = yield _appiumSupport.fs.which(fullBinaryName);

      _logger.default.info(`Using '${fullBinaryName}' from '${binaryLoc}'`);

      this.binaries[binaryName] = binaryLoc;
      return binaryLoc;
    } catch (e) {
      throw new Error(`Could not find '${fullBinaryName}' in PATH. Please set the ANDROID_HOME ` + `environment variable with the Android SDK root directory path.`);
    }
  });

  return function getBinaryFromPath(_x3) {
    return _getBinaryFromPath.apply(this, arguments);
  };
}();

systemCallMethods.getConnectedDevices = function () {
  var _getConnectedDevices = (0, _asyncToGenerator2.default)(function* () {
    _logger.default.debug('Getting connected devices...');

    try {
      let _ref = yield (0, _teen_process.exec)(this.executable.path, this.executable.defaultArgs.concat(['devices'])),
          stdout = _ref.stdout;

      let startingIndex = stdout.indexOf('List of devices');

      if (startingIndex === -1) {
        throw new Error(`Unexpected output while trying to get devices. output was: ${stdout}`);
      }

      stdout = stdout.slice(startingIndex);
      let devices = [];
      var _iteratorNormalCompletion2 = true;
      var _didIteratorError2 = false;
      var _iteratorError2 = undefined;

      try {
        for (var _iterator2 = stdout.split('\n')[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
          let line = _step2.value;

          if (line.trim() !== '' && line.indexOf('List of devices') === -1 && line.indexOf('adb server') === -1 && line.indexOf('* daemon') === -1 && line.indexOf('offline') === -1) {
            let lineInfo = line.split('\t');
            devices.push({
              udid: lineInfo[0],
              state: lineInfo[1]
            });
          }
        }
      } catch (err) {
        _didIteratorError2 = true;
        _iteratorError2 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion2 && _iterator2.return != null) {
            _iterator2.return();
          }
        } finally {
          if (_didIteratorError2) {
            throw _iteratorError2;
          }
        }
      }

      _logger.default.debug(`${devices.length} device(s) connected`);

      return devices;
    } catch (e) {
      throw new Error(`Error while getting connected devices. Original error: ${e.message}`);
    }
  });

  return function getConnectedDevices() {
    return _getConnectedDevices.apply(this, arguments);
  };
}();

systemCallMethods.getDevicesWithRetry = function () {
  var _getDevicesWithRetry = (0, _asyncToGenerator2.default)(function* (timeoutMs = 20000) {
    var _this = this;

    let start = Date.now();

    _logger.default.debug('Trying to find a connected android device');

    let getDevices = function () {
      var _ref2 = (0, _asyncToGenerator2.default)(function* () {
        if (Date.now() - start > timeoutMs) {
          throw new Error('Could not find a connected Android device.');
        }

        try {
          let devices = yield _this.getConnectedDevices();

          if (devices.length < 1) {
            _logger.default.debug('Could not find devices, restarting adb server...');

            yield _this.restartAdb();
            yield (0, _asyncbox.sleep)(200);
            return yield getDevices();
          }

          return devices;
        } catch (e) {
          _logger.default.debug('Could not find devices, restarting adb server...');

          yield _this.restartAdb();
          yield (0, _asyncbox.sleep)(200);
          return yield getDevices();
        }
      });

      return function getDevices() {
        return _ref2.apply(this, arguments);
      };
    }();

    return yield getDevices();
  });

  return function getDevicesWithRetry() {
    return _getDevicesWithRetry.apply(this, arguments);
  };
}();

systemCallMethods.restartAdb = function () {
  var _restartAdb = (0, _asyncToGenerator2.default)(function* () {
    if (this.suppressKillServer) {
      _logger.default.debug(`Not restarting abd since 'suppressKillServer' is on`);

      return;
    }

    _logger.default.debug('Restarting adb');

    try {
      yield this.killServer();
    } catch (e) {
      _logger.default.error("Error killing ADB server, going to see if it's online anyway");
    }
  });

  return function restartAdb() {
    return _restartAdb.apply(this, arguments);
  };
}();

systemCallMethods.killServer = function () {
  var _killServer = (0, _asyncToGenerator2.default)(function* () {
    _logger.default.debug(`Killing adb server on port ${this.adbPort}`);

    yield (0, _teen_process.exec)(this.executable.path, [...this.executable.defaultArgs, 'kill-server']);
  });

  return function killServer() {
    return _killServer.apply(this, arguments);
  };
}();

systemCallMethods.resetTelnetAuthToken = _lodash.default.memoize(function () {
  var _resetTelnetAuthToken = (0, _asyncToGenerator2.default)(function* () {
    const homeFolderPath = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'];

    if (!homeFolderPath) {
      _logger.default.warn(`Cannot find the path to user home folder. Ignoring resetting of emulator's telnet authentication token`);

      return false;
    }

    const dstPath = _path.default.resolve(homeFolderPath, '.emulator_console_auth_token');

    _logger.default.debug(`Overriding ${dstPath} with an empty string to avoid telnet authentication for emulator commands`);

    try {
      yield _appiumSupport.fs.writeFile(dstPath, '');
    } catch (e) {
      _logger.default.warn(`Error ${e.message} while resetting the content of ${dstPath}. Ignoring resetting of emulator's telnet authentication token`);

      return false;
    }

    return true;
  });

  return function resetTelnetAuthToken() {
    return _resetTelnetAuthToken.apply(this, arguments);
  };
}());

systemCallMethods.adbExecEmu = function () {
  var _adbExecEmu = (0, _asyncToGenerator2.default)(function* (cmd) {
    yield this.verifyEmulatorConnected();
    yield this.resetTelnetAuthToken();
    yield this.adbExec(['emu', ...cmd]);
  });

  return function adbExecEmu(_x4) {
    return _adbExecEmu.apply(this, arguments);
  };
}();

systemCallMethods.adbExec = function () {
  var _adbExec = (0, _asyncToGenerator2.default)(function* (cmd, opts = {}) {
    var _this2 = this;

    if (!cmd) {
      throw new Error('You need to pass in a command to adbExec()');
    }

    opts = _lodash.default.cloneDeep(opts);
    opts.timeout = opts.timeout || this.adbExecTimeout || _helpers.DEFAULT_ADB_EXEC_TIMEOUT;
    opts.timeoutCapName = opts.timeoutCapName || 'adbExecTimeout';
    cmd = _lodash.default.isArray(cmd) ? cmd : [cmd];
    let adbRetried = false;

    const execFunc = function () {
      var _ref3 = (0, _asyncToGenerator2.default)(function* () {
        try {
          const args = _this2.executable.defaultArgs.concat(cmd);

          _logger.default.debug(`Running '${_this2.executable.path} ${(0, _shellQuote.quote)(args)}'`);
          const debugInfo = `[[[DEBUG info: ${_this2.executable.path} ${(0, _shellQuote.quote)(args)} --udid ${process.env.DEVICEUDID} --name ${process.env.DEVICENAME}]]]`;

          let _ref4 = yield (0, _teen_process.exec)(_this2.executable.path, args, opts),
              stdout = _ref4.stdout;

          stdout = stdout.replace(LINKER_WARNING_REGEXP, '').trim();
          return stdout + '\n' + debugInfo;
        } catch (e) {
          const errText = `${e.message}, ${e.stdout}, ${e.stderr}`;
          const protocolFaultError = PROTOCOL_FAULT_ERROR_REGEXP.test(errText);
          const deviceNotFoundError = DEVICE_NOT_FOUND_ERROR_REGEXP.test(errText);
          const deviceConnectingError = DEVICE_CONNECTING_ERROR_REGEXP.test(errText);

          if (protocolFaultError || deviceNotFoundError || deviceConnectingError) {
            _logger.default.info(`Error sending command, reconnecting device and retrying: ${cmd}`);

            yield (0, _asyncbox.sleep)(1000);
            yield _this2.getDevicesWithRetry();

            if (adbRetried) {
              adbRetried = true;
              return yield execFunc();
            }
          }

          if (e.code === 0 && e.stdout) {
            return e.stdout.replace(LINKER_WARNING_REGEXP, '').trim();
          }

          if (_lodash.default.isNull(e.code)) {
            e.message = `Error executing adbExec. Original error: '${e.message}'. ` + `Try to increase the ${opts.timeout}ms adb execution timeout represented by '${opts.timeoutCapName}' capability`;
          } else {
            e.message = `Error executing adbExec. Original error: '${e.message}'; ` + `Stderr: '${(e.stderr || '').trim()}'; Code: '${e.code}'`;
          }

          throw e;
        }
      });

      return function execFunc() {
        return _ref3.apply(this, arguments);
      };
    }();

    return yield execFunc();
  });

  return function adbExec(_x5) {
    return _adbExec.apply(this, arguments);
  };
}();

systemCallMethods.shell = function () {
  var _shell = (0, _asyncToGenerator2.default)(function* (cmd, opts = {}) {
    const privileged = opts.privileged,
          keepPrivileged = opts.keepPrivileged;
    let shouldRestoreUser = false;

    if (privileged) {
      _logger.default.info(`'adb shell ${cmd}' requires root access. Attempting to gain root access now.`);

      const _ref5 = yield this.root(),
            wasAlreadyRooted = _ref5.wasAlreadyRooted,
            isSuccessful = _ref5.isSuccessful;

      shouldRestoreUser = !wasAlreadyRooted;

      if (wasAlreadyRooted) {
        _logger.default.info('Device already had root access');
      } else {
        _logger.default.info(isSuccessful ? 'Root access successfully gained' : 'Could not gain root access');
      }
    }

    let didCommandFail = false;

    try {
      try {
        return yield this.adbExec(_lodash.default.isArray(cmd) ? ['shell', ...cmd] : ['shell', cmd], opts);
      } catch (err) {
        didCommandFail = true;
        throw err;
      }
    } finally {
      if (privileged && shouldRestoreUser && (!keepPrivileged || didCommandFail)) {
        const _ref6 = yield this.unroot(),
              isSuccessful = _ref6.isSuccessful;

        _logger.default.debug(isSuccessful ? 'Returned device to unrooted state' : 'Could not return device to unrooted state');
      }
    }
  });

  return function shell(_x6) {
    return _shell.apply(this, arguments);
  };
}();

systemCallMethods.createSubProcess = function createSubProcess(args = []) {
  args = this.executable.defaultArgs.concat(args);

  _logger.default.debug(`Creating ADB subprocess with args: ${JSON.stringify(args)}`);

  return new _teen_process.SubProcess(this.getAdbPath(), args);
};

systemCallMethods.getAdbServerPort = function getAdbServerPort() {
  return this.adbPort;
};

systemCallMethods.getEmulatorPort = function () {
  var _getEmulatorPort = (0, _asyncToGenerator2.default)(function* () {
    _logger.default.debug('Getting running emulator port');

    if (this.emulatorPort !== null) {
      return this.emulatorPort;
    }

    try {
      let devices = yield this.getConnectedDevices();
      let port = this.getPortFromEmulatorString(devices[0].udid);

      if (port) {
        return port;
      } else {
        throw new Error(`Emulator port not found`);
      }
    } catch (e) {
      throw new Error(`No devices connected. Original error: ${e.message}`);
    }
  });

  return function getEmulatorPort() {
    return _getEmulatorPort.apply(this, arguments);
  };
}();

systemCallMethods.getPortFromEmulatorString = function getPortFromEmulatorString(emStr) {
  let portPattern = /emulator-(\d+)/;

  if (portPattern.test(emStr)) {
    return parseInt(portPattern.exec(emStr)[1], 10);
  }

  return false;
};

systemCallMethods.getConnectedEmulators = function () {
  var _getConnectedEmulators = (0, _asyncToGenerator2.default)(function* () {
    _logger.default.debug('Getting connected emulators');

    try {
      let devices = yield this.getConnectedDevices();
      let emulators = [];
      var _iteratorNormalCompletion3 = true;
      var _didIteratorError3 = false;
      var _iteratorError3 = undefined;

      try {
        for (var _iterator3 = devices[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
          let device = _step3.value;
          let port = this.getPortFromEmulatorString(device.udid);

          if (port) {
            device.port = port;
            emulators.push(device);
          }
        }
      } catch (err) {
        _didIteratorError3 = true;
        _iteratorError3 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion3 && _iterator3.return != null) {
            _iterator3.return();
          }
        } finally {
          if (_didIteratorError3) {
            throw _iteratorError3;
          }
        }
      }

      _logger.default.debug(`${emulators.length} emulator(s) connected`);

      return emulators;
    } catch (e) {
      throw new Error(`Error getting emulators. Original error: ${e.message}`);
    }
  });

  return function getConnectedEmulators() {
    return _getConnectedEmulators.apply(this, arguments);
  };
}();

systemCallMethods.setEmulatorPort = function setEmulatorPort(emPort) {
  this.emulatorPort = emPort;
};

systemCallMethods.setDeviceId = function setDeviceId(deviceId) {
  _logger.default.debug(`Setting device id to ${deviceId}`);

  this.curDeviceId = deviceId;
  let argsHasDevice = this.executable.defaultArgs.indexOf('-s');

  if (argsHasDevice !== -1) {
    this.executable.defaultArgs.splice(argsHasDevice, 2);
  }

  this.executable.defaultArgs.push('-s', deviceId);
};

systemCallMethods.setDevice = function setDevice(deviceObj) {
  let deviceId = deviceObj.udid;
  let emPort = this.getPortFromEmulatorString(deviceId);
  this.setEmulatorPort(emPort);
  this.setDeviceId(deviceId);
};

systemCallMethods.getRunningAVD = function () {
  var _getRunningAVD = (0, _asyncToGenerator2.default)(function* (avdName) {
    _logger.default.debug(`Trying to find '${avdName}' emulator`);

    try {
      const emulators = yield this.getConnectedEmulators();
      var _iteratorNormalCompletion4 = true;
      var _didIteratorError4 = false;
      var _iteratorError4 = undefined;

      try {
        for (var _iterator4 = emulators[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
          const emulator = _step4.value;
          this.setEmulatorPort(emulator.port);
          const runningAVDName = yield this.sendTelnetCommand('avd name');

          if (_lodash.default.toLower(avdName) === _lodash.default.toLower(runningAVDName)) {
            _logger.default.debug(`Found emulator '${avdName}' on port ${emulator.port}`);

            this.setDeviceId(emulator.udid);
            return emulator;
          }
        }
      } catch (err) {
        _didIteratorError4 = true;
        _iteratorError4 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion4 && _iterator4.return != null) {
            _iterator4.return();
          }
        } finally {
          if (_didIteratorError4) {
            throw _iteratorError4;
          }
        }
      }

      _logger.default.debug(`Emulator '${avdName}' not running`);

      return null;
    } catch (e) {
      throw new Error(`Error getting AVD. Original error: ${e.message}`);
    }
  });

  return function getRunningAVD(_x7) {
    return _getRunningAVD.apply(this, arguments);
  };
}();

systemCallMethods.getRunningAVDWithRetry = function () {
  var _getRunningAVDWithRetry = (0, _asyncToGenerator2.default)(function* (avdName, timeoutMs = 20000) {
    var _this3 = this;

    let runningAvd;

    try {
      yield (0, _asyncbox.waitForCondition)((0, _asyncToGenerator2.default)(function* () {
        try {
          runningAvd = yield _this3.getRunningAVD(avdName.replace('@', ''));
          return runningAvd;
        } catch (e) {
          _logger.default.debug(e.message);

          return false;
        }
      }), {
        waitMs: timeoutMs,
        intervalMs: 1000
      });
    } catch (e) {
      throw new Error(`Error getting AVD with retry. Original error: ${e.message}`);
    }

    return runningAvd;
  });

  return function getRunningAVDWithRetry(_x8) {
    return _getRunningAVDWithRetry.apply(this, arguments);
  };
}();

systemCallMethods.killAllEmulators = function () {
  var _killAllEmulators = (0, _asyncToGenerator2.default)(function* () {
    let cmd, args;

    if (_appiumSupport.system.isWindows()) {
      cmd = 'TASKKILL';
      args = ['TASKKILL', '/IM', 'emulator.exe'];
    } else {
      cmd = '/usr/bin/killall';
      args = ['-m', 'emulator*'];
    }

    try {
      yield (0, _teen_process.exec)(cmd, args);
    } catch (e) {
      throw new Error(`Error killing emulators. Original error: ${e.message}`);
    }
  });

  return function killAllEmulators() {
    return _killAllEmulators.apply(this, arguments);
  };
}();

systemCallMethods.killEmulator = function () {
  var _killEmulator = (0, _asyncToGenerator2.default)(function* (avdName = null, timeout = 60000) {
    var _this4 = this;

    if (_appiumSupport.util.hasValue(avdName)) {
      _logger.default.debug(`Killing avd '${avdName}'`);

      const device = yield this.getRunningAVD(avdName);

      if (!device) {
        _logger.default.info(`No avd with name '${avdName}' running. Skipping kill step.`);

        return false;
      }
    } else {
      _logger.default.debug(`Killing avd with id '${this.curDeviceId}'`);

      if (!(yield this.isEmulatorConnected())) {
        _logger.default.debug(`Emulator with id '${this.curDeviceId}' not connected. Skipping kill step`);

        return false;
      }
    }

    yield this.adbExec(['emu', 'kill']);

    _logger.default.debug(`Waiting up to ${timeout}ms until the emulator '${avdName ? avdName : this.curDeviceId}' is killed`);

    try {
      yield (0, _asyncbox.waitForCondition)((0, _asyncToGenerator2.default)(function* () {
        try {
          return _appiumSupport.util.hasValue(avdName) ? !(yield _this4.getRunningAVD(avdName)) : !(yield _this4.isEmulatorConnected());
        } catch (ign) {}

        return false;
      }), {
        waitMs: timeout,
        intervalMs: 2000
      });
    } catch (e) {
      throw new Error(`The emulator '${avdName ? avdName : this.curDeviceId}' is still running after being killed ${timeout}ms ago`);
    }

    _logger.default.info(`Successfully killed the '${avdName ? avdName : this.curDeviceId}' emulator`);

    return true;
  });

  return function killEmulator() {
    return _killEmulator.apply(this, arguments);
  };
}();

systemCallMethods.launchAVD = function () {
  var _launchAVD = (0, _asyncToGenerator2.default)(function* (avdName, avdArgs, language, country, avdLaunchTimeout = 60000, avdReadyTimeout = 60000, retryTimes = 1) {
    var _this5 = this;

    _logger.default.debug(`Launching Emulator with AVD ${avdName}, launchTimeout ` + `${avdLaunchTimeout}ms and readyTimeout ${avdReadyTimeout}ms`);

    let emulatorBinaryPath = yield this.getSdkBinaryPath('emulator');

    if (avdName[0] === '@') {
      avdName = avdName.substr(1);
    }

    yield this.checkAvdExist(avdName);
    let launchArgs = ['-avd', avdName];

    if (_lodash.default.isString(language)) {
      _logger.default.debug(`Setting Android Device Language to ${language}`);

      launchArgs.push('-prop', `persist.sys.language=${language.toLowerCase()}`);
    }

    if (_lodash.default.isString(country)) {
      _logger.default.debug(`Setting Android Device Country to ${country}`);

      launchArgs.push('-prop', `persist.sys.country=${country.toUpperCase()}`);
    }

    let locale;

    if (_lodash.default.isString(language) && _lodash.default.isString(country)) {
      locale = language.toLowerCase() + '-' + country.toUpperCase();
    } else if (_lodash.default.isString(language)) {
      locale = language.toLowerCase();
    } else if (_lodash.default.isString(country)) {
      locale = country;
    }

    if (_lodash.default.isString(locale)) {
      _logger.default.debug(`Setting Android Device Locale to ${locale}`);

      launchArgs.push('-prop', `persist.sys.locale=${locale}`);
    }

    if (!_lodash.default.isEmpty(avdArgs)) {
      launchArgs.push(...(_lodash.default.isArray(avdArgs) ? avdArgs : avdArgs.split(' ')));
    }

    _logger.default.debug(`Running '${emulatorBinaryPath}' with args: ${JSON.stringify(launchArgs)}`);

    let proc = new _teen_process.SubProcess(emulatorBinaryPath, launchArgs);
    yield proc.start(0);
    proc.on('output', (stdout, stderr) => {
      var _iteratorNormalCompletion5 = true;
      var _didIteratorError5 = false;
      var _iteratorError5 = undefined;

      try {
        for (var _iterator5 = (stdout || stderr || '').split('\n').filter(Boolean)[Symbol.iterator](), _step5; !(_iteratorNormalCompletion5 = (_step5 = _iterator5.next()).done); _iteratorNormalCompletion5 = true) {
          let line = _step5.value;

          _logger.default.info(`[AVD OUTPUT] ${line}`);
        }
      } catch (err) {
        _didIteratorError5 = true;
        _iteratorError5 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion5 && _iterator5.return != null) {
            _iterator5.return();
          }
        } finally {
          if (_didIteratorError5) {
            throw _iteratorError5;
          }
        }
      }
    });
    proc.on('die', (code, signal) => {
      _logger.default.warn(`Emulator avd ${avdName} exited with code ${code}${signal ? `, signal ${signal}` : ''}`);
    });
    yield (0, _asyncbox.retry)(retryTimes, (0, _asyncToGenerator2.default)(function* () {
      return yield _this5.getRunningAVDWithRetry(avdName, avdLaunchTimeout);
    }));
    yield this.waitForEmulatorReady(avdReadyTimeout);
    return proc;
  });

  return function launchAVD(_x9, _x10, _x11, _x12) {
    return _launchAVD.apply(this, arguments);
  };
}();

systemCallMethods.getAdbVersion = _lodash.default.memoize(function () {
  var _getAdbVersion = (0, _asyncToGenerator2.default)(function* () {
    try {
      let adbVersion = (yield this.adbExec('version')).replace(/Android\sDebug\sBridge\sversion\s([\d.]*)[\s\w-]*/, '$1');
      let parts = adbVersion.split('.');
      return {
        versionString: adbVersion,
        versionFloat: parseFloat(adbVersion),
        major: parseInt(parts[0], 10),
        minor: parseInt(parts[1], 10),
        patch: parts[2] ? parseInt(parts[2], 10) : undefined
      };
    } catch (e) {
      throw new Error(`Error getting adb version. Original error: '${e.message}'; ` + `Stderr: '${(e.stderr || '').trim()}'; Code: '${e.code}'`);
    }
  });

  return function getAdbVersion() {
    return _getAdbVersion.apply(this, arguments);
  };
}());

systemCallMethods.checkAvdExist = function () {
  var _checkAvdExist = (0, _asyncToGenerator2.default)(function* (avdName) {
    let cmd, result;

    try {
      cmd = yield this.getSdkBinaryPath('emulator');
      result = yield (0, _teen_process.exec)(cmd, ['-list-avds']);
    } catch (e) {
      let unknownOptionError = new RegExp('unknown option: -list-avds', 'i').test(e.stderr);

      if (!unknownOptionError) {
        throw new Error(`Error executing checkAvdExist. Original error: '${e.message}'; ` + `Stderr: '${(e.stderr || '').trim()}'; Code: '${e.code}'`);
      }

      const sdkVersion = yield (0, _helpers.getSdkToolsVersion)();
      let binaryName = 'android';

      if (sdkVersion) {
        if (sdkVersion.major >= 25) {
          binaryName = 'avdmanager';
        }
      } else {
        _logger.default.warn(`Defaulting binary name to '${binaryName}', because SDK version cannot be parsed`);
      }

      cmd = yield this.getSdkBinaryPath(binaryName);
      result = yield (0, _teen_process.exec)(cmd, ['list', 'avd', '-c']);
    }

    if (result.stdout.indexOf(avdName) === -1) {
      let existings = `(${result.stdout.trim().replace(/[\n]/g, '), (')})`;
      throw new Error(`Avd '${avdName}' is not available. please select your avd name from one of these: '${existings}'`);
    }
  });

  return function checkAvdExist(_x13) {
    return _checkAvdExist.apply(this, arguments);
  };
}();

systemCallMethods.waitForEmulatorReady = function () {
  var _waitForEmulatorReady = (0, _asyncToGenerator2.default)(function* (timeoutMs = 20000) {
    var _this6 = this;

    try {
      yield (0, _asyncbox.waitForCondition)((0, _asyncToGenerator2.default)(function* () {
        try {
          if (!(yield _this6.shell(['getprop', 'init.svc.bootanim'])).includes('stopped')) {
            return false;
          }

          return /\d+\[\w+\]/.test((yield _this6.shell(['pm', 'get-install-location'])));
        } catch (err) {
          _logger.default.debug(`Waiting for emulator startup. Intermediate error: ${err.message}`);

          return false;
        }
      }), {
        waitMs: timeoutMs,
        intervalMs: 3000
      });
    } catch (e) {
      throw new Error(`Emulator is not ready within ${timeoutMs}ms`);
    }
  });

  return function waitForEmulatorReady() {
    return _waitForEmulatorReady.apply(this, arguments);
  };
}();

systemCallMethods.waitForDevice = function () {
  var _waitForDevice = (0, _asyncToGenerator2.default)(function* (appDeviceReadyTimeout = 30) {
    var _this7 = this;

    this.appDeviceReadyTimeout = appDeviceReadyTimeout;
    const retries = 3;
    const timeout = parseInt(this.appDeviceReadyTimeout, 10) / retries * 1000;
    yield (0, _asyncbox.retry)(retries, (0, _asyncToGenerator2.default)(function* () {
      try {
        yield _this7.adbExec('wait-for-device', {
          timeout
        });
        yield _this7.ping();
      } catch (e) {
        yield _this7.restartAdb();
        yield _this7.getConnectedDevices();
        throw new Error(`Error waiting for the device to be available. Original error: '${e.message}'`);
      }
    }));
  });

  return function waitForDevice() {
    return _waitForDevice.apply(this, arguments);
  };
}();

systemCallMethods.reboot = function () {
  var _reboot = (0, _asyncToGenerator2.default)(function* (retries = DEFAULT_ADB_REBOOT_RETRIES) {
    var _this8 = this;

    const _ref12 = yield this.root(),
          wasAlreadyRooted = _ref12.wasAlreadyRooted;

    try {
      yield this.shell(['stop']);
      yield _bluebird.default.delay(2000);
      yield this.setDeviceProperty('sys.boot_completed', 0, {
        privileged: false
      });
      yield this.shell(['start']);
    } catch (e) {
      const message = e.message;

      if (message.includes('must be root')) {
        throw new Error(`Could not reboot device. Rebooting requires root access and ` + `attempt to get root access on device failed with error: '${message}'`);
      }

      throw e;
    } finally {
      if (!wasAlreadyRooted) {
        yield this.unroot();
      }
    }

    const started = process.hrtime();
    yield (0, _asyncbox.retryInterval)(retries, 1000, (0, _asyncToGenerator2.default)(function* () {
      if ((yield _this8.getDeviceProperty('sys.boot_completed')) === '1') {
        return;
      }

      const msg = `Reboot is not completed after ${process.hrtime(started)[0]}s`;

      _logger.default.debug(msg);

      throw new Error(msg);
    }));
  });

  return function reboot() {
    return _reboot.apply(this, arguments);
  };
}();

systemCallMethods.changeUserPrivileges = function () {
  var _changeUserPrivileges = (0, _asyncToGenerator2.default)(function* (isElevated) {
    const cmd = isElevated ? 'root' : 'unroot';
    const isRoot = yield this.isRoot();

    if (isRoot && isElevated || !isRoot && !isElevated) {
      return {
        isSuccessful: true,
        wasAlreadyRooted: isRoot
      };
    }

    let wasAlreadyRooted = isRoot;

    try {
      let _ref14 = yield (0, _teen_process.exec)(this.executable.path, [cmd]),
          stdout = _ref14.stdout;

      if (stdout) {
        if (stdout.includes('adbd cannot run as root')) {
          return {
            isSuccessful: false,
            wasAlreadyRooted
          };
        }

        if (stdout.includes('already running as root')) {
          wasAlreadyRooted = true;
        }
      }

      return {
        isSuccessful: true,
        wasAlreadyRooted
      };
    } catch (err) {
      const _err$stderr = err.stderr,
            stderr = _err$stderr === void 0 ? '' : _err$stderr,
            message = err.message;

      _logger.default.warn(`Unable to ${cmd} adb daemon. Original error: '${message}'. Stderr: '${stderr}'. Continuing.`);

      if (['closed', 'device offline'].includes(x => stderr.toLowerCase().includes(x))) {
        _logger.default.warn(`Attempt to 'adb ${cmd}' caused device to go offline. Restarting adb.`);

        yield this.restartAdb();
      }

      return {
        isSuccessful: false,
        wasAlreadyRooted
      };
    }
  });

  return function changeUserPrivileges(_x14) {
    return _changeUserPrivileges.apply(this, arguments);
  };
}();

systemCallMethods.root = function () {
  var _root = (0, _asyncToGenerator2.default)(function* () {
    return yield this.changeUserPrivileges(true);
  });

  return function root() {
    return _root.apply(this, arguments);
  };
}();

systemCallMethods.unroot = function () {
  var _unroot = (0, _asyncToGenerator2.default)(function* () {
    return yield this.changeUserPrivileges(false);
  });

  return function unroot() {
    return _unroot.apply(this, arguments);
  };
}();

systemCallMethods.isRoot = function () {
  var _isRoot = (0, _asyncToGenerator2.default)(function* () {
    return (yield this.shell(['whoami'])).trim() === 'root';
  });

  return function isRoot() {
    return _isRoot.apply(this, arguments);
  };
}();

systemCallMethods.fileExists = function () {
  var _fileExists = (0, _asyncToGenerator2.default)(function* (remotePath) {
    let files = yield this.ls(remotePath);
    return files.length > 0;
  });

  return function fileExists(_x15) {
    return _fileExists.apply(this, arguments);
  };
}();

systemCallMethods.ls = function () {
  var _ls = (0, _asyncToGenerator2.default)(function* (remotePath, opts = []) {
    try {
      let args = ['ls', ...opts, remotePath];
      let stdout = yield this.shell(args);
      let lines = stdout.split('\n');
      return lines.map(l => l.trim()).filter(Boolean).filter(l => l.indexOf('No such file') === -1);
    } catch (err) {
      if (err.message.indexOf('No such file or directory') === -1) {
        throw err;
      }

      return [];
    }
  });

  return function ls(_x16) {
    return _ls.apply(this, arguments);
  };
}();

systemCallMethods.fileSize = function () {
  var _fileSize = (0, _asyncToGenerator2.default)(function* (remotePath) {
    try {
      const files = yield this.ls(remotePath, ['-la']);

      if (files.length !== 1) {
        throw new Error(`Remote path is not a file`);
      }

      const match = /[rwxsStT\-+]{10}[\s\d]*\s[^\s]+\s+[^\s]+\s+(\d+)/.exec(files[0]);

      if (!match || _lodash.default.isNaN(parseInt(match[1], 10))) {
        throw new Error(`Unable to parse size from list output: '${files[0]}'`);
      }

      return parseInt(match[1], 10);
    } catch (err) {
      throw new Error(`Unable to get file size for '${remotePath}': ${err.message}`);
    }
  });

  return function fileSize(_x17) {
    return _fileSize.apply(this, arguments);
  };
}();

systemCallMethods.installMitmCertificate = function () {
  var _installMitmCertificate = (0, _asyncToGenerator2.default)(function* (cert) {
    var _this9 = this;

    const openSsl = yield (0, _helpers.getOpenSslForOs)();

    if (!_lodash.default.isBuffer(cert)) {
      cert = Buffer.from(cert, 'base64');
    }

    const tmpRoot = yield _appiumSupport.tempDir.openDir();

    try {
      const srcCert = _path.default.resolve(tmpRoot, 'source.cer');

      yield _appiumSupport.fs.writeFile(srcCert, cert);

      let _ref15 = yield (0, _teen_process.exec)(openSsl, ['x509', '-noout', '-hash', '-in', srcCert]),
          stdout = _ref15.stdout;

      const certHash = stdout.trim();

      _logger.default.debug(`Got certificate hash: ${certHash}`);

      _logger.default.debug('Preparing certificate content');

      var _ref16 = yield (0, _teen_process.exec)(openSsl, ['x509', '-in', srcCert], {
        isBuffer: true
      });

      stdout = _ref16.stdout;
      let dstCertContent = stdout;

      var _ref17 = yield (0, _teen_process.exec)(openSsl, ['x509', '-in', srcCert, '-text', '-fingerprint', '-noout'], {
        isBuffer: true
      });

      stdout = _ref17.stdout;
      dstCertContent = Buffer.concat([dstCertContent, stdout]);

      const dstCert = _path.default.resolve(tmpRoot, `${certHash}.0`);

      yield _appiumSupport.fs.writeFile(dstCert, dstCertContent);

      _logger.default.debug('Remounting /system in rw mode');

      yield (0, _asyncbox.retryInterval)(5, 2000, (0, _asyncToGenerator2.default)(function* () {
        return yield _this9.adbExec(['remount']);
      }));

      _logger.default.debug(`Uploading the generated certificate from '${dstCert}' to '${CERTS_ROOT}'`);

      yield this.push(dstCert, CERTS_ROOT);

      _logger.default.debug('Remounting /system to confirm changes');

      yield this.adbExec(['remount']);
    } catch (err) {
      throw new Error(`Cannot inject the custom certificate. ` + `Is the certificate properly encoded into base64-string? ` + `Do you have root permissions on the device? ` + `Original error: ${err.message}`);
    } finally {
      yield _appiumSupport.fs.rimraf(tmpRoot);
    }
  });

  return function installMitmCertificate(_x18) {
    return _installMitmCertificate.apply(this, arguments);
  };
}();

systemCallMethods.isMitmCertificateInstalled = function () {
  var _isMitmCertificateInstalled = (0, _asyncToGenerator2.default)(function* (cert) {
    const openSsl = yield (0, _helpers.getOpenSslForOs)();

    if (!_lodash.default.isBuffer(cert)) {
      cert = Buffer.from(cert, 'base64');
    }

    const tmpRoot = yield _appiumSupport.tempDir.openDir();
    let certHash;

    try {
      const tmpCert = _path.default.resolve(tmpRoot, 'source.cer');

      yield _appiumSupport.fs.writeFile(tmpCert, cert);

      const _ref19 = yield (0, _teen_process.exec)(openSsl, ['x509', '-noout', '-hash', '-in', tmpCert]),
            stdout = _ref19.stdout;

      certHash = stdout.trim();
    } catch (err) {
      throw new Error(`Cannot retrieve the certificate hash. ` + `Is the certificate properly encoded into base64-string? ` + `Original error: ${err.message}`);
    } finally {
      yield _appiumSupport.fs.rimraf(tmpRoot);
    }

    const dstPath = _path.default.posix.resolve(CERTS_ROOT, `${certHash}.0`);

    _logger.default.debug(`Checking if the certificate is already installed at '${dstPath}'`);

    return yield this.fileExists(dstPath);
  });

  return function isMitmCertificateInstalled(_x19) {
    return _isMitmCertificateInstalled.apply(this, arguments);
  };
}();

var _default = systemCallMethods;
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi90b29scy9zeXN0ZW0tY2FsbHMuanMiXSwibmFtZXMiOlsic3lzdGVtQ2FsbE1ldGhvZHMiLCJERUZBVUxUX0FEQl9SRUJPT1RfUkVUUklFUyIsIkxJTktFUl9XQVJOSU5HX1JFR0VYUCIsIlBST1RPQ09MX0ZBVUxUX0VSUk9SX1JFR0VYUCIsIlJlZ0V4cCIsIkRFVklDRV9OT1RfRk9VTkRfRVJST1JfUkVHRVhQIiwiREVWSUNFX0NPTk5FQ1RJTkdfRVJST1JfUkVHRVhQIiwiQ0VSVFNfUk9PVCIsImdldFNka0JpbmFyeVBhdGgiLCJiaW5hcnlOYW1lIiwic2RrUm9vdCIsImdldEJpbmFyeUZyb21TZGtSb290IiwibG9nIiwid2FybiIsImdldEJpbmFyeUZyb21QYXRoIiwiZ2V0QmluYXJ5TmFtZUZvck9TIiwiXyIsIm1lbW9pemUiLCJzeXN0ZW0iLCJpc1dpbmRvd3MiLCJpbmNsdWRlcyIsInBhdGgiLCJleHRuYW1lIiwiYmluYXJpZXMiLCJmdWxsQmluYXJ5TmFtZSIsImJpbmFyeUxvY3MiLCJzZXAiLCJtYXAiLCJ4IiwicmVzb2x2ZSIsImJ1aWxkVG9vbHNEaXJzIiwiYnVpbGRUb29sc1ZlcnNpb24iLCJmaWx0ZXIiLCJiYXNlbmFtZSIsImlzRW1wdHkiLCJpbmZvIiwicHVzaCIsImRpciIsImJpbmFyeUxvYyIsImxvYyIsImZzIiwiZXhpc3RzIiwiaXNOdWxsIiwiRXJyb3IiLCJKU09OIiwic3RyaW5naWZ5Iiwid2hpY2giLCJlIiwiZ2V0Q29ubmVjdGVkRGV2aWNlcyIsImRlYnVnIiwiZXhlY3V0YWJsZSIsImRlZmF1bHRBcmdzIiwiY29uY2F0Iiwic3Rkb3V0Iiwic3RhcnRpbmdJbmRleCIsImluZGV4T2YiLCJzbGljZSIsImRldmljZXMiLCJzcGxpdCIsImxpbmUiLCJ0cmltIiwibGluZUluZm8iLCJ1ZGlkIiwic3RhdGUiLCJsZW5ndGgiLCJtZXNzYWdlIiwiZ2V0RGV2aWNlc1dpdGhSZXRyeSIsInRpbWVvdXRNcyIsInN0YXJ0IiwiRGF0ZSIsIm5vdyIsImdldERldmljZXMiLCJyZXN0YXJ0QWRiIiwic3VwcHJlc3NLaWxsU2VydmVyIiwia2lsbFNlcnZlciIsImVycm9yIiwiYWRiUG9ydCIsInJlc2V0VGVsbmV0QXV0aFRva2VuIiwiaG9tZUZvbGRlclBhdGgiLCJwcm9jZXNzIiwiZW52IiwicGxhdGZvcm0iLCJkc3RQYXRoIiwid3JpdGVGaWxlIiwiYWRiRXhlY0VtdSIsImNtZCIsInZlcmlmeUVtdWxhdG9yQ29ubmVjdGVkIiwiYWRiRXhlYyIsIm9wdHMiLCJjbG9uZURlZXAiLCJ0aW1lb3V0IiwiYWRiRXhlY1RpbWVvdXQiLCJERUZBVUxUX0FEQl9FWEVDX1RJTUVPVVQiLCJ0aW1lb3V0Q2FwTmFtZSIsImlzQXJyYXkiLCJhZGJSZXRyaWVkIiwiZXhlY0Z1bmMiLCJhcmdzIiwicmVwbGFjZSIsImVyclRleHQiLCJzdGRlcnIiLCJwcm90b2NvbEZhdWx0RXJyb3IiLCJ0ZXN0IiwiZGV2aWNlTm90Rm91bmRFcnJvciIsImRldmljZUNvbm5lY3RpbmdFcnJvciIsImNvZGUiLCJzaGVsbCIsInByaXZpbGVnZWQiLCJrZWVwUHJpdmlsZWdlZCIsInNob3VsZFJlc3RvcmVVc2VyIiwicm9vdCIsIndhc0FscmVhZHlSb290ZWQiLCJpc1N1Y2Nlc3NmdWwiLCJkaWRDb21tYW5kRmFpbCIsImVyciIsInVucm9vdCIsImNyZWF0ZVN1YlByb2Nlc3MiLCJTdWJQcm9jZXNzIiwiZ2V0QWRiUGF0aCIsImdldEFkYlNlcnZlclBvcnQiLCJnZXRFbXVsYXRvclBvcnQiLCJlbXVsYXRvclBvcnQiLCJwb3J0IiwiZ2V0UG9ydEZyb21FbXVsYXRvclN0cmluZyIsImVtU3RyIiwicG9ydFBhdHRlcm4iLCJwYXJzZUludCIsImV4ZWMiLCJnZXRDb25uZWN0ZWRFbXVsYXRvcnMiLCJlbXVsYXRvcnMiLCJkZXZpY2UiLCJzZXRFbXVsYXRvclBvcnQiLCJlbVBvcnQiLCJzZXREZXZpY2VJZCIsImRldmljZUlkIiwiY3VyRGV2aWNlSWQiLCJhcmdzSGFzRGV2aWNlIiwic3BsaWNlIiwic2V0RGV2aWNlIiwiZGV2aWNlT2JqIiwiZ2V0UnVubmluZ0FWRCIsImF2ZE5hbWUiLCJlbXVsYXRvciIsInJ1bm5pbmdBVkROYW1lIiwic2VuZFRlbG5ldENvbW1hbmQiLCJ0b0xvd2VyIiwiZ2V0UnVubmluZ0FWRFdpdGhSZXRyeSIsInJ1bm5pbmdBdmQiLCJ3YWl0TXMiLCJpbnRlcnZhbE1zIiwia2lsbEFsbEVtdWxhdG9ycyIsImtpbGxFbXVsYXRvciIsInV0aWwiLCJoYXNWYWx1ZSIsImlzRW11bGF0b3JDb25uZWN0ZWQiLCJpZ24iLCJsYXVuY2hBVkQiLCJhdmRBcmdzIiwibGFuZ3VhZ2UiLCJjb3VudHJ5IiwiYXZkTGF1bmNoVGltZW91dCIsImF2ZFJlYWR5VGltZW91dCIsInJldHJ5VGltZXMiLCJlbXVsYXRvckJpbmFyeVBhdGgiLCJzdWJzdHIiLCJjaGVja0F2ZEV4aXN0IiwibGF1bmNoQXJncyIsImlzU3RyaW5nIiwidG9Mb3dlckNhc2UiLCJ0b1VwcGVyQ2FzZSIsImxvY2FsZSIsInByb2MiLCJvbiIsIkJvb2xlYW4iLCJzaWduYWwiLCJ3YWl0Rm9yRW11bGF0b3JSZWFkeSIsImdldEFkYlZlcnNpb24iLCJhZGJWZXJzaW9uIiwicGFydHMiLCJ2ZXJzaW9uU3RyaW5nIiwidmVyc2lvbkZsb2F0IiwicGFyc2VGbG9hdCIsIm1ham9yIiwibWlub3IiLCJwYXRjaCIsInVuZGVmaW5lZCIsInJlc3VsdCIsInVua25vd25PcHRpb25FcnJvciIsInNka1ZlcnNpb24iLCJleGlzdGluZ3MiLCJ3YWl0Rm9yRGV2aWNlIiwiYXBwRGV2aWNlUmVhZHlUaW1lb3V0IiwicmV0cmllcyIsInBpbmciLCJyZWJvb3QiLCJCIiwiZGVsYXkiLCJzZXREZXZpY2VQcm9wZXJ0eSIsInN0YXJ0ZWQiLCJocnRpbWUiLCJnZXREZXZpY2VQcm9wZXJ0eSIsIm1zZyIsImNoYW5nZVVzZXJQcml2aWxlZ2VzIiwiaXNFbGV2YXRlZCIsImlzUm9vdCIsImZpbGVFeGlzdHMiLCJyZW1vdGVQYXRoIiwiZmlsZXMiLCJscyIsImxpbmVzIiwibCIsImZpbGVTaXplIiwibWF0Y2giLCJpc05hTiIsImluc3RhbGxNaXRtQ2VydGlmaWNhdGUiLCJjZXJ0Iiwib3BlblNzbCIsImlzQnVmZmVyIiwiQnVmZmVyIiwiZnJvbSIsInRtcFJvb3QiLCJ0ZW1wRGlyIiwib3BlbkRpciIsInNyY0NlcnQiLCJjZXJ0SGFzaCIsImRzdENlcnRDb250ZW50IiwiZHN0Q2VydCIsInJpbXJhZiIsImlzTWl0bUNlcnRpZmljYXRlSW5zdGFsbGVkIiwidG1wQ2VydCIsInBvc2l4Il0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUtBOztBQUNBOztBQUNBOztBQUNBOztBQUdBLElBQUlBLGlCQUFpQixHQUFHLEVBQXhCO0FBRUEsTUFBTUMsMEJBQTBCLEdBQUcsRUFBbkM7QUFFQSxNQUFNQyxxQkFBcUIsR0FBRyxzQkFBOUI7QUFDQSxNQUFNQywyQkFBMkIsR0FBRyxJQUFJQyxNQUFKLENBQVcsZ0NBQVgsRUFBNkMsR0FBN0MsQ0FBcEM7QUFDQSxNQUFNQyw2QkFBNkIsR0FBRyxJQUFJRCxNQUFKLENBQVksaUNBQVosRUFBOEMsR0FBOUMsQ0FBdEM7QUFDQSxNQUFNRSw4QkFBOEIsR0FBRyxJQUFJRixNQUFKLENBQVcsZ0NBQVgsRUFBNkMsR0FBN0MsQ0FBdkM7QUFFQSxNQUFNRyxVQUFVLEdBQUcsOEJBQW5COztBQVFBUCxpQkFBaUIsQ0FBQ1EsZ0JBQWxCO0FBQUEsMERBQXFDLFdBQWlDQyxVQUFqQyxFQUE2QztBQUNoRixRQUFJLEtBQUtDLE9BQVQsRUFBa0I7QUFDaEIsbUJBQWEsS0FBS0Msb0JBQUwsQ0FBMEJGLFVBQTFCLENBQWI7QUFDRDs7QUFDREcsb0JBQUlDLElBQUosQ0FBVSxzRUFBRCxHQUNOLGtFQURNLEdBRU4seUNBQXdDSixVQUFXLEdBRnREOztBQUdBLGlCQUFhLEtBQUtLLGlCQUFMLENBQXVCTCxVQUF2QixDQUFiO0FBQ0QsR0FSRDs7QUFBQSxr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WyJpbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBsb2cgZnJvbSAnLi4vbG9nZ2VyLmpzJztcbmltcG9ydCBCIGZyb20gJ2JsdWViaXJkJztcbmltcG9ydCB7IHN5c3RlbSwgZnMsIHV0aWwsIHRlbXBEaXIgfSBmcm9tICdhcHBpdW0tc3VwcG9ydCc7XG5pbXBvcnQge1xuICBnZXRTZGtUb29sc1ZlcnNpb24sXG4gIGdldEJ1aWxkVG9vbHNEaXJzLFxuICBnZXRPcGVuU3NsRm9yT3MsXG4gIERFRkFVTFRfQURCX0VYRUNfVElNRU9VVCB9IGZyb20gJy4uL2hlbHBlcnMnO1xuaW1wb3J0IHsgZXhlYywgU3ViUHJvY2VzcyB9IGZyb20gJ3RlZW5fcHJvY2Vzcyc7XG5pbXBvcnQgeyBzbGVlcCwgcmV0cnksIHJldHJ5SW50ZXJ2YWwsIHdhaXRGb3JDb25kaXRpb24gfSBmcm9tICdhc3luY2JveCc7XG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IHsgcXVvdGUgfSBmcm9tICdzaGVsbC1xdW90ZSc7XG5cblxubGV0IHN5c3RlbUNhbGxNZXRob2RzID0ge307XG5cbmNvbnN0IERFRkFVTFRfQURCX1JFQk9PVF9SRVRSSUVTID0gOTA7XG5cbmNvbnN0IExJTktFUl9XQVJOSU5HX1JFR0VYUCA9IC9eV0FSTklORzogbGlua2VyLiskL207XG5jb25zdCBQUk9UT0NPTF9GQVVMVF9FUlJPUl9SRUdFWFAgPSBuZXcgUmVnRXhwKCdwcm90b2NvbCBmYXVsdCBcXFxcKG5vIHN0YXR1c1xcXFwpJywgJ2knKTtcbmNvbnN0IERFVklDRV9OT1RfRk9VTkRfRVJST1JfUkVHRVhQID0gbmV3IFJlZ0V4cChgZXJyb3I6IGRldmljZSAoJy4rJyApP25vdCBmb3VuZGAsICdpJyk7XG5jb25zdCBERVZJQ0VfQ09OTkVDVElOR19FUlJPUl9SRUdFWFAgPSBuZXcgUmVnRXhwKCdlcnJvcjogZGV2aWNlIHN0aWxsIGNvbm5lY3RpbmcnLCAnaScpO1xuXG5jb25zdCBDRVJUU19ST09UID0gJy9zeXN0ZW0vZXRjL3NlY3VyaXR5L2NhY2VydHMnO1xuXG4vKipcbiAqIFJldHJpZXZlIGZ1bGwgcGF0aCB0byB0aGUgZ2l2ZW4gYmluYXJ5LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBiaW5hcnlOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGJpbmFyeS5cbiAqIEByZXR1cm4ge3N0cmluZ30gRnVsbCBwYXRoIHRvIHRoZSBnaXZlbiBiaW5hcnkgaW5jbHVkaW5nIGN1cnJlbnQgU0RLIHJvb3QuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmdldFNka0JpbmFyeVBhdGggPSBhc3luYyBmdW5jdGlvbiBnZXRTZGtCaW5hcnlQYXRoIChiaW5hcnlOYW1lKSB7XG4gIGlmICh0aGlzLnNka1Jvb3QpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRCaW5hcnlGcm9tU2RrUm9vdChiaW5hcnlOYW1lKTtcbiAgfVxuICBsb2cud2FybihgVGhlIEFORFJPSURfSE9NRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyBub3Qgc2V0IHRvIHRoZSBBbmRyb2lkIFNESyBgICtcbiAgICBgcm9vdCBkaXJlY3RvcnkgcGF0aC4gQU5EUk9JRF9IT01FIGlzIHJlcXVpcmVkIGZvciBjb21wYXRpYmlsaXR5IGAgK1xuICAgIGB3aXRoIFNESyAyMysuIENoZWNraW5nIGFsb25nIFBBVEggZm9yICR7YmluYXJ5TmFtZX0uYCk7XG4gIHJldHVybiBhd2FpdCB0aGlzLmdldEJpbmFyeUZyb21QYXRoKGJpbmFyeU5hbWUpO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSBmdWxsIGJpbmFyeSBuYW1lIGZvciB0aGUgY3VycmVudCBvcGVyYXRpbmcgc3lzdGVtLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBiaW5hcnlOYW1lIC0gc2ltcGxlIGJpbmFyeSBuYW1lLCBmb3IgZXhhbXBsZSAnYW5kcm9pZCcuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEZvcm1hdHRlZCBiaW5hcnkgbmFtZSBkZXBlbmRpbmcgb24gdGhlIGN1cnJlbnQgcGxhdGZvcm0sXG4gKiAgICAgICAgICAgICAgICAgIGZvciBleGFtcGxlLCAnYW5kcm9pZC5iYXQnIG9uIFdpbmRvd3MuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmdldEJpbmFyeU5hbWVGb3JPUyA9IF8ubWVtb2l6ZShmdW5jdGlvbiBnZXRCaW5hcnlOYW1lRm9yT1MgKGJpbmFyeU5hbWUpIHtcbiAgaWYgKCFzeXN0ZW0uaXNXaW5kb3dzKCkpIHtcbiAgICByZXR1cm4gYmluYXJ5TmFtZTtcbiAgfVxuXG4gIGlmIChbJ2FuZHJvaWQnLCAnYXBrc2lnbmVyJywgJ2Fwa2FuYWx5emVyJ10uaW5jbHVkZXMoYmluYXJ5TmFtZSkpIHtcbiAgICByZXR1cm4gYCR7YmluYXJ5TmFtZX0uYmF0YDtcbiAgfVxuICBpZiAoIXBhdGguZXh0bmFtZShiaW5hcnlOYW1lKSkge1xuICAgIHJldHVybiBgJHtiaW5hcnlOYW1lfS5leGVgO1xuICB9XG4gIHJldHVybiBiaW5hcnlOYW1lO1xufSk7XG5cbi8qKlxuICogUmV0cmlldmUgZnVsbCBwYXRoIHRvIHRoZSBnaXZlbiBiaW5hcnkgYW5kIGNhY2hlcyBpdCBpbnRvIGBiaW5hcmllc2BcbiAqIHByb3BlcnR5IG9mIHRoZSBjdXJyZW50IEFEQiBpbnN0YW5jZS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gYmluYXJ5TmFtZSAtIFNpbXBsZSBuYW1lIG9mIGEgYmluYXJ5IGZpbGUuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEZ1bGwgcGF0aCB0byB0aGUgZ2l2ZW4gYmluYXJ5LiBUaGUgbWV0aG9kIHRyaWVzXG4gKiAgICAgICAgICAgICAgICAgIHRvIGVudW1lcmF0ZSBhbGwgdGhlIGtub3duIGxvY2F0aW9ucyB3aGVyZSB0aGUgYmluYXJ5XG4gKiAgICAgICAgICAgICAgICAgIG1pZ2h0IGJlIGxvY2F0ZWQgYW5kIHN0b3BzIHRoZSBzZWFyY2ggYXMgc29vbiBhcyB0aGUgZmlyc3RcbiAqICAgICAgICAgICAgICAgICAgbWF0Y2ggaXMgZm91bmQgb24gdGhlIGxvY2FsIGZpbGUgc3lzdGVtLlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBiaW5hcnkgd2l0aCBnaXZlbiBuYW1lIGlzIG5vdCBwcmVzZW50IGF0IGFueVxuICogICAgICAgICAgICAgICAgIG9mIGtub3duIGxvY2F0aW9ucyBvciBBbmRyb2lkIFNESyBpcyBub3QgaW5zdGFsbGVkIG9uIHRoZVxuICogICAgICAgICAgICAgICAgIGxvY2FsIGZpbGUgc3lzdGVtLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5nZXRCaW5hcnlGcm9tU2RrUm9vdCA9IGFzeW5jIGZ1bmN0aW9uIGdldEJpbmFyeUZyb21TZGtSb290IChiaW5hcnlOYW1lKSB7XG4gIGlmICh0aGlzLmJpbmFyaWVzW2JpbmFyeU5hbWVdKSB7XG4gICAgcmV0dXJuIHRoaXMuYmluYXJpZXNbYmluYXJ5TmFtZV07XG4gIH1cblxuICBjb25zdCBmdWxsQmluYXJ5TmFtZSA9IHRoaXMuZ2V0QmluYXJ5TmFtZUZvck9TKGJpbmFyeU5hbWUpO1xuICBjb25zdCBiaW5hcnlMb2NzID0gWydwbGF0Zm9ybS10b29scycsICdlbXVsYXRvcicsICd0b29scycsIGB0b29scyR7cGF0aC5zZXB9YmluYF1cbiAgICAubWFwKCh4KSA9PiBwYXRoLnJlc29sdmUodGhpcy5zZGtSb290LCB4LCBmdWxsQmluYXJ5TmFtZSkpO1xuICAvLyBnZXQgc3VicGF0aHMgZm9yIGN1cnJlbnRseSBpbnN0YWxsZWQgYnVpbGQgdG9vbCBkaXJlY3Rvcmllc1xuICBsZXQgYnVpbGRUb29sc0RpcnMgPSBhd2FpdCBnZXRCdWlsZFRvb2xzRGlycyh0aGlzLnNka1Jvb3QpO1xuICBpZiAodGhpcy5idWlsZFRvb2xzVmVyc2lvbikge1xuICAgIGJ1aWxkVG9vbHNEaXJzID0gYnVpbGRUb29sc0RpcnNcbiAgICAgIC5maWx0ZXIoKHgpID0+IHBhdGguYmFzZW5hbWUoeCkgPT09IHRoaXMuYnVpbGRUb29sc1ZlcnNpb24pO1xuICAgIGlmIChfLmlzRW1wdHkoYnVpbGRUb29sc0RpcnMpKSB7XG4gICAgICBsb2cuaW5mbyhgRm91bmQgbm8gYnVpbGQgdG9vbHMgd2hvc2UgdmVyc2lvbiBtYXRjaGVzIHRvICcke3RoaXMuYnVpbGRUb29sc1ZlcnNpb259J2ApO1xuICAgIH0gZWxzZSB7XG4gICAgICBsb2cuaW5mbyhgVXNpbmcgYnVpbGQgdG9vbHMgYXQgJyR7YnVpbGRUb29sc0RpcnN9J2ApO1xuICAgIH1cbiAgfVxuICBiaW5hcnlMb2NzLnB1c2goLi4uKGJ1aWxkVG9vbHNEaXJzLm1hcCgoZGlyKSA9PiBwYXRoLnJlc29sdmUoZGlyLCBmdWxsQmluYXJ5TmFtZSkpKSk7XG5cbiAgbGV0IGJpbmFyeUxvYyA9IG51bGw7XG4gIGZvciAoY29uc3QgbG9jIG9mIGJpbmFyeUxvY3MpIHtcbiAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGxvYykpIHtcbiAgICAgIGJpbmFyeUxvYyA9IGxvYztcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICBpZiAoXy5pc051bGwoYmluYXJ5TG9jKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IGZpbmQgJyR7ZnVsbEJpbmFyeU5hbWV9JyBpbiAke0pTT04uc3RyaW5naWZ5KGJpbmFyeUxvY3MpfS4gYCArXG4gICAgICBgRG8geW91IGhhdmUgQW5kcm9pZCBCdWlsZCBUb29scyAke3RoaXMuYnVpbGRUb29sc1ZlcnNpb24gPyBgdiAke3RoaXMuYnVpbGRUb29sc1ZlcnNpb259IGAgOiAnJ31gICtcbiAgICAgIGBpbnN0YWxsZWQgYXQgJyR7dGhpcy5zZGtSb290fSc/YCk7XG4gIH1cbiAgbG9nLmluZm8oYFVzaW5nICcke2Z1bGxCaW5hcnlOYW1lfScgZnJvbSAnJHtiaW5hcnlMb2N9J2ApO1xuICB0aGlzLmJpbmFyaWVzW2JpbmFyeU5hbWVdID0gYmluYXJ5TG9jO1xuICByZXR1cm4gYmluYXJ5TG9jO1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSBmdWxsIHBhdGggdG8gYSBiaW5hcnkgZmlsZSB1c2luZyB0aGUgc3RhbmRhcmQgc3lzdGVtIGxvb2t1cCB0b29sLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBiaW5hcnlOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIGJpbmFyeS5cbiAqIEByZXR1cm4ge3N0cmluZ30gRnVsbCBwYXRoIHRvIHRoZSBiaW5hcnkgcmVjZWl2ZWQgZnJvbSAnd2hpY2gnLyd3aGVyZSdcbiAqICAgICAgICAgICAgICAgICAgb3V0cHV0LlxuICogQHRocm93cyB7RXJyb3J9IElmIGxvb2t1cCB0b29sIHJldHVybnMgbm9uLXplcm8gcmV0dXJuIGNvZGUuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmdldEJpbmFyeUZyb21QYXRoID0gYXN5bmMgZnVuY3Rpb24gZ2V0QmluYXJ5RnJvbVBhdGggKGJpbmFyeU5hbWUpIHtcbiAgaWYgKHRoaXMuYmluYXJpZXNbYmluYXJ5TmFtZV0pIHtcbiAgICByZXR1cm4gdGhpcy5iaW5hcmllc1tiaW5hcnlOYW1lXTtcbiAgfVxuXG4gIGNvbnN0IGZ1bGxCaW5hcnlOYW1lID0gdGhpcy5nZXRCaW5hcnlOYW1lRm9yT1MoYmluYXJ5TmFtZSk7XG4gIHRyeSB7XG4gICAgY29uc3QgYmluYXJ5TG9jID0gYXdhaXQgZnMud2hpY2goZnVsbEJpbmFyeU5hbWUpO1xuICAgIGxvZy5pbmZvKGBVc2luZyAnJHtmdWxsQmluYXJ5TmFtZX0nIGZyb20gJyR7YmluYXJ5TG9jfSdgKTtcbiAgICB0aGlzLmJpbmFyaWVzW2JpbmFyeU5hbWVdID0gYmluYXJ5TG9jO1xuICAgIHJldHVybiBiaW5hcnlMb2M7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBmaW5kICcke2Z1bGxCaW5hcnlOYW1lfScgaW4gUEFUSC4gUGxlYXNlIHNldCB0aGUgQU5EUk9JRF9IT01FIGAgK1xuICAgICAgYGVudmlyb25tZW50IHZhcmlhYmxlIHdpdGggdGhlIEFuZHJvaWQgU0RLIHJvb3QgZGlyZWN0b3J5IHBhdGguYCk7XG4gIH1cbn07XG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gRGV2aWNlXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdWRpZCAtIFRoZSBkZXZpY2UgdWRpZC5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBzdGF0ZSAtIEN1cnJlbnQgZGV2aWNlIHN0YXRlLCBhcyBpdCBpcyB2aXNpYmxlIGluXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICBfYWRiIGRldmljZXMgLWxfIG91dHB1dC5cbiAqL1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIGRldmljZXMgdmlzaWJsZSB0byBhZGIuXG4gKlxuICogQHJldHVybiB7QXJyYXkuPERldmljZT59IFRoZSBsaXN0IG9mIGRldmljZXMgb3IgYW4gZW1wdHkgbGlzdCBpZlxuICogICAgICAgICAgICAgICAgICAgICAgICAgIG5vIGRldmljZXMgYXJlIGNvbm5lY3RlZC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGVyZSB3YXMgYW4gZXJyb3Igd2hpbGUgbGlzdGluZyBkZXZpY2VzLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5nZXRDb25uZWN0ZWREZXZpY2VzID0gYXN5bmMgZnVuY3Rpb24gZ2V0Q29ubmVjdGVkRGV2aWNlcyAoKSB7XG4gIGxvZy5kZWJ1ZygnR2V0dGluZyBjb25uZWN0ZWQgZGV2aWNlcy4uLicpO1xuICB0cnkge1xuICAgIGxldCB7c3Rkb3V0fSA9IGF3YWl0IGV4ZWModGhpcy5leGVjdXRhYmxlLnBhdGgsIHRoaXMuZXhlY3V0YWJsZS5kZWZhdWx0QXJncy5jb25jYXQoWydkZXZpY2VzJ10pKTtcbiAgICAvLyBleHBlY3RpbmcgYWRiIGRldmljZXMgdG8gcmV0dXJuIG91dHB1dCBhc1xuICAgIC8vIExpc3Qgb2YgZGV2aWNlcyBhdHRhY2hlZFxuICAgIC8vIGVtdWxhdG9yLTU1NTRcdGRldmljZVxuICAgIGxldCBzdGFydGluZ0luZGV4ID0gc3Rkb3V0LmluZGV4T2YoJ0xpc3Qgb2YgZGV2aWNlcycpO1xuICAgIGlmIChzdGFydGluZ0luZGV4ID09PSAtMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIG91dHB1dCB3aGlsZSB0cnlpbmcgdG8gZ2V0IGRldmljZXMuIG91dHB1dCB3YXM6ICR7c3Rkb3V0fWApO1xuICAgIH1cbiAgICAvLyBzbGljaW5nIG91cHV0IHdlIGNhcmUgYWJvdXQuXG4gICAgc3Rkb3V0ID0gc3Rkb3V0LnNsaWNlKHN0YXJ0aW5nSW5kZXgpO1xuICAgIGxldCBkZXZpY2VzID0gW107XG4gICAgZm9yIChsZXQgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgICBpZiAobGluZS50cmltKCkgIT09ICcnICYmXG4gICAgICAgICAgbGluZS5pbmRleE9mKCdMaXN0IG9mIGRldmljZXMnKSA9PT0gLTEgJiZcbiAgICAgICAgICBsaW5lLmluZGV4T2YoJ2FkYiBzZXJ2ZXInKSA9PT0gLTEgJiZcbiAgICAgICAgICBsaW5lLmluZGV4T2YoJyogZGFlbW9uJykgPT09IC0xICYmXG4gICAgICAgICAgbGluZS5pbmRleE9mKCdvZmZsaW5lJykgPT09IC0xKSB7XG4gICAgICAgIGxldCBsaW5lSW5mbyA9IGxpbmUuc3BsaXQoJ1xcdCcpO1xuICAgICAgICAvLyBzdGF0ZSBpcyBlaXRoZXIgXCJkZXZpY2VcIiBvciBcIm9mZmxpbmVcIiwgYWZhaWN0XG4gICAgICAgIGRldmljZXMucHVzaCh7dWRpZDogbGluZUluZm9bMF0sIHN0YXRlOiBsaW5lSW5mb1sxXX0pO1xuICAgICAgfVxuICAgIH1cbiAgICBsb2cuZGVidWcoYCR7ZGV2aWNlcy5sZW5ndGh9IGRldmljZShzKSBjb25uZWN0ZWRgKTtcbiAgICByZXR1cm4gZGV2aWNlcztcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3Igd2hpbGUgZ2V0dGluZyBjb25uZWN0ZWQgZGV2aWNlcy4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIGRldmljZXMgdmlzaWJsZSB0byBhZGIgd2l0aGluIHRoZSBnaXZlbiB0aW1lb3V0LlxuICpcbiAqIEBwYXJhbSB7bnVtYmVyfSB0aW1lb3V0TXMgLSBUaGUgbWF4aW11bSBudW1iZXIgb2YgbWlsbGlzZWNvbmRzIHRvIGdldCBhdCBsZWFzdFxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uZSBsaXN0IGl0ZW0uXG4gKiBAcmV0dXJuIHtBcnJheS48RGV2aWNlPn0gVGhlIGxpc3Qgb2YgY29ubmVjdGVkIGRldmljZXMuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgbm8gY29ubmVjdGVkIGRldmljZXMgY2FuIGJlIGRldGVjdGVkIHdpdGhpbiB0aGUgZ2l2ZW4gdGltZW91dC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0RGV2aWNlc1dpdGhSZXRyeSA9IGFzeW5jIGZ1bmN0aW9uIGdldERldmljZXNXaXRoUmV0cnkgKHRpbWVvdXRNcyA9IDIwMDAwKSB7XG4gIGxldCBzdGFydCA9IERhdGUubm93KCk7XG4gIGxvZy5kZWJ1ZygnVHJ5aW5nIHRvIGZpbmQgYSBjb25uZWN0ZWQgYW5kcm9pZCBkZXZpY2UnKTtcbiAgbGV0IGdldERldmljZXMgPSBhc3luYyAoKSA9PiB7XG4gICAgaWYgKChEYXRlLm5vdygpIC0gc3RhcnQpID4gdGltZW91dE1zKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvdWxkIG5vdCBmaW5kIGEgY29ubmVjdGVkIEFuZHJvaWQgZGV2aWNlLicpO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgbGV0IGRldmljZXMgPSBhd2FpdCB0aGlzLmdldENvbm5lY3RlZERldmljZXMoKTtcbiAgICAgIGlmIChkZXZpY2VzLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgbG9nLmRlYnVnKCdDb3VsZCBub3QgZmluZCBkZXZpY2VzLCByZXN0YXJ0aW5nIGFkYiBzZXJ2ZXIuLi4nKTtcbiAgICAgICAgYXdhaXQgdGhpcy5yZXN0YXJ0QWRiKCk7XG4gICAgICAgIC8vIGNvb2wgZG93blxuICAgICAgICBhd2FpdCBzbGVlcCgyMDApO1xuICAgICAgICByZXR1cm4gYXdhaXQgZ2V0RGV2aWNlcygpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGRldmljZXM7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgbG9nLmRlYnVnKCdDb3VsZCBub3QgZmluZCBkZXZpY2VzLCByZXN0YXJ0aW5nIGFkYiBzZXJ2ZXIuLi4nKTtcbiAgICAgIGF3YWl0IHRoaXMucmVzdGFydEFkYigpO1xuICAgICAgLy8gY29vbCBkb3duXG4gICAgICBhd2FpdCBzbGVlcCgyMDApO1xuICAgICAgcmV0dXJuIGF3YWl0IGdldERldmljZXMoKTtcbiAgICB9XG4gIH07XG4gIHJldHVybiBhd2FpdCBnZXREZXZpY2VzKCk7XG59O1xuXG4vKipcbiAqIFJlc3RhcnQgYWRiIHNlcnZlciwgdW5sZXNzIF90aGlzLnN1cHByZXNzS2lsbFNlcnZlcl8gcHJvcGVydHkgaXMgdHJ1ZS5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMucmVzdGFydEFkYiA9IGFzeW5jIGZ1bmN0aW9uIHJlc3RhcnRBZGIgKCkge1xuICBpZiAodGhpcy5zdXBwcmVzc0tpbGxTZXJ2ZXIpIHtcbiAgICBsb2cuZGVidWcoYE5vdCByZXN0YXJ0aW5nIGFiZCBzaW5jZSAnc3VwcHJlc3NLaWxsU2VydmVyJyBpcyBvbmApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGxvZy5kZWJ1ZygnUmVzdGFydGluZyBhZGInKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCB0aGlzLmtpbGxTZXJ2ZXIoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGxvZy5lcnJvcihcIkVycm9yIGtpbGxpbmcgQURCIHNlcnZlciwgZ29pbmcgdG8gc2VlIGlmIGl0J3Mgb25saW5lIGFueXdheVwiKTtcbiAgfVxufTtcblxuLyoqXG4gKiBLaWxsIGFkYiBzZXJ2ZXIuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmtpbGxTZXJ2ZXIgPSBhc3luYyBmdW5jdGlvbiBraWxsU2VydmVyICgpIHtcbiAgbG9nLmRlYnVnKGBLaWxsaW5nIGFkYiBzZXJ2ZXIgb24gcG9ydCAke3RoaXMuYWRiUG9ydH1gKTtcbiAgYXdhaXQgZXhlYyh0aGlzLmV4ZWN1dGFibGUucGF0aCwgWy4uLnRoaXMuZXhlY3V0YWJsZS5kZWZhdWx0QXJncywgJ2tpbGwtc2VydmVyJ10pO1xufTtcblxuLyoqXG4gKiBSZXNldCBUZWxuZXQgYXV0aGVudGljYXRpb24gdG9rZW4uXG4gKiBAc2VlIHtAbGluayBodHRwOi8vdG9vbHMuYW5kcm9pZC5jb20vcmVjZW50L2VtdWxhdG9yMjUxNnJlbGVhc2Vub3Rlc30gZm9yIG1vcmUgZGV0YWlscy5cbiAqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gSWYgdG9rZW4gcmVzZXQgd2FzIHN1Y2Nlc3NmdWwuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLnJlc2V0VGVsbmV0QXV0aFRva2VuID0gXy5tZW1vaXplKGFzeW5jIGZ1bmN0aW9uIHJlc2V0VGVsbmV0QXV0aFRva2VuICgpIHtcbiAgLy8gVGhlIG1ldGhvZHMgaXMgdXNlZCB0byByZW1vdmUgdGVsbmV0IGF1dGggdG9rZW5cbiAgLy9cbiAgY29uc3QgaG9tZUZvbGRlclBhdGggPSBwcm9jZXNzLmVudlsocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykgPyAnVVNFUlBST0ZJTEUnIDogJ0hPTUUnXTtcbiAgaWYgKCFob21lRm9sZGVyUGF0aCkge1xuICAgIGxvZy53YXJuKGBDYW5ub3QgZmluZCB0aGUgcGF0aCB0byB1c2VyIGhvbWUgZm9sZGVyLiBJZ25vcmluZyByZXNldHRpbmcgb2YgZW11bGF0b3IncyB0ZWxuZXQgYXV0aGVudGljYXRpb24gdG9rZW5gKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgY29uc3QgZHN0UGF0aCA9IHBhdGgucmVzb2x2ZShob21lRm9sZGVyUGF0aCwgJy5lbXVsYXRvcl9jb25zb2xlX2F1dGhfdG9rZW4nKTtcbiAgbG9nLmRlYnVnKGBPdmVycmlkaW5nICR7ZHN0UGF0aH0gd2l0aCBhbiBlbXB0eSBzdHJpbmcgdG8gYXZvaWQgdGVsbmV0IGF1dGhlbnRpY2F0aW9uIGZvciBlbXVsYXRvciBjb21tYW5kc2ApO1xuICB0cnkge1xuICAgIGF3YWl0IGZzLndyaXRlRmlsZShkc3RQYXRoLCAnJyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBsb2cud2FybihgRXJyb3IgJHtlLm1lc3NhZ2V9IHdoaWxlIHJlc2V0dGluZyB0aGUgY29udGVudCBvZiAke2RzdFBhdGh9LiBJZ25vcmluZyByZXNldHRpbmcgb2YgZW11bGF0b3IncyB0ZWxuZXQgYXV0aGVudGljYXRpb24gdG9rZW5gKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59KTtcblxuLyoqXG4gKiBFeGVjdXRlIHRoZSBnaXZlbiBlbXVsYXRvciBjb21tYW5kIHVzaW5nIF9hZGIgZW11XyB0b29sLlxuICpcbiAqIEBwYXJhbSB7QXJyYXkuPHN0cmluZz59IGNtZCAtIFRoZSBhcnJheSBvZiByZXN0IGNvbW1hbmQgbGluZSBwYXJhbWV0ZXJzLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5hZGJFeGVjRW11ID0gYXN5bmMgZnVuY3Rpb24gYWRiRXhlY0VtdSAoY21kKSB7XG4gIGF3YWl0IHRoaXMudmVyaWZ5RW11bGF0b3JDb25uZWN0ZWQoKTtcbiAgYXdhaXQgdGhpcy5yZXNldFRlbG5ldEF1dGhUb2tlbigpO1xuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydlbXUnLCAuLi5jbWRdKTtcbn07XG5cbi8qKlxuICogRXhlY3V0ZSB0aGUgZ2l2ZW4gYWRiIGNvbW1hbmQuXG4gKlxuICogQHBhcmFtIHtBcnJheS48c3RyaW5nPn0gY21kIC0gVGhlIGFycmF5IG9mIHJlc3QgY29tbWFuZCBsaW5lIHBhcmFtZXRlcnNcbiAqICAgICAgICAgICAgICAgICAgICAgIG9yIGEgc2luZ2xlIHN0cmluZyBwYXJhbWV0ZXIuXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0cyAtIEFkZGl0aW9uYWwgb3B0aW9ucyBtYXBwaW5nLiBTZWVcbiAqICAgICAgICAgICAgICAgICAgICAgICAge0BsaW5rIGh0dHBzOi8vZ2l0aHViLmNvbS9hcHBpdW0vbm9kZS10ZWVuX3Byb2Nlc3N9XG4gKiAgICAgICAgICAgICAgICAgICAgICAgIGZvciBtb3JlIGRldGFpbHMuXG4gKiBAcmV0dXJuIHtzdHJpbmd9IC0gQ29tbWFuZCdzIHN0ZG91dC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgY29tbWFuZCByZXR1cm5lZCBub24temVybyBleGl0IGNvZGUuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmFkYkV4ZWMgPSBhc3luYyBmdW5jdGlvbiBhZGJFeGVjIChjbWQsIG9wdHMgPSB7fSkge1xuICBpZiAoIWNtZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignWW91IG5lZWQgdG8gcGFzcyBpbiBhIGNvbW1hbmQgdG8gYWRiRXhlYygpJyk7XG4gIH1cblxuICBvcHRzID0gXy5jbG9uZURlZXAob3B0cyk7XG4gIC8vIHNldHRpbmcgZGVmYXVsdCB0aW1lb3V0IGZvciBlYWNoIGNvbW1hbmQgdG8gcHJldmVudCBpbmZpbml0ZSB3YWl0LlxuICBvcHRzLnRpbWVvdXQgPSBvcHRzLnRpbWVvdXQgfHwgdGhpcy5hZGJFeGVjVGltZW91dCB8fCBERUZBVUxUX0FEQl9FWEVDX1RJTUVPVVQ7XG4gIG9wdHMudGltZW91dENhcE5hbWUgPSBvcHRzLnRpbWVvdXRDYXBOYW1lIHx8ICdhZGJFeGVjVGltZW91dCc7IC8vIEZvciBlcnJvciBtZXNzYWdlXG5cbiAgY21kID0gXy5pc0FycmF5KGNtZCkgPyBjbWQgOiBbY21kXTtcblxuICBsZXQgYWRiUmV0cmllZCA9IGZhbHNlO1xuICBjb25zdCBleGVjRnVuYyA9IGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYXJncyA9IHRoaXMuZXhlY3V0YWJsZS5kZWZhdWx0QXJncy5jb25jYXQoY21kKTtcbiAgICAgIGxvZy5kZWJ1ZyhgUnVubmluZyAnJHt0aGlzLmV4ZWN1dGFibGUucGF0aH0gJHtxdW90ZShhcmdzKX0nYCk7XG4gICAgICBsZXQge3N0ZG91dH0gPSBhd2FpdCBleGVjKHRoaXMuZXhlY3V0YWJsZS5wYXRoLCBhcmdzLCBvcHRzKTtcbiAgICAgIC8vIHNvbWV0aW1lcyBBREIgcHJpbnRzIG91dCB3ZWlyZCBzdGRvdXQgd2FybmluZ3MgdGhhdCB3ZSBkb24ndCB3YW50XG4gICAgICAvLyB0byBpbmNsdWRlIGluIGFueSBvZiB0aGUgcmVzcG9uc2UgZGF0YSwgc28gbGV0J3Mgc3RyaXAgaXQgb3V0XG4gICAgICBzdGRvdXQgPSBzdGRvdXQucmVwbGFjZShMSU5LRVJfV0FSTklOR19SRUdFWFAsICcnKS50cmltKCk7XG4gICAgICByZXR1cm4gc3Rkb3V0O1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnN0IGVyclRleHQgPSBgJHtlLm1lc3NhZ2V9LCAke2Uuc3Rkb3V0fSwgJHtlLnN0ZGVycn1gO1xuICAgICAgY29uc3QgcHJvdG9jb2xGYXVsdEVycm9yID0gUFJPVE9DT0xfRkFVTFRfRVJST1JfUkVHRVhQLnRlc3QoZXJyVGV4dCk7XG4gICAgICBjb25zdCBkZXZpY2VOb3RGb3VuZEVycm9yID0gREVWSUNFX05PVF9GT1VORF9FUlJPUl9SRUdFWFAudGVzdChlcnJUZXh0KTtcbiAgICAgIGNvbnN0IGRldmljZUNvbm5lY3RpbmdFcnJvciA9IERFVklDRV9DT05ORUNUSU5HX0VSUk9SX1JFR0VYUC50ZXN0KGVyclRleHQpO1xuICAgICAgaWYgKHByb3RvY29sRmF1bHRFcnJvciB8fCBkZXZpY2VOb3RGb3VuZEVycm9yIHx8IGRldmljZUNvbm5lY3RpbmdFcnJvcikge1xuICAgICAgICBsb2cuaW5mbyhgRXJyb3Igc2VuZGluZyBjb21tYW5kLCByZWNvbm5lY3RpbmcgZGV2aWNlIGFuZCByZXRyeWluZzogJHtjbWR9YCk7XG4gICAgICAgIGF3YWl0IHNsZWVwKDEwMDApO1xuICAgICAgICBhd2FpdCB0aGlzLmdldERldmljZXNXaXRoUmV0cnkoKTtcblxuICAgICAgICAvLyB0cnkgYWdhaW4gb25lIHRpbWVcbiAgICAgICAgaWYgKGFkYlJldHJpZWQpIHtcbiAgICAgICAgICBhZGJSZXRyaWVkID0gdHJ1ZTtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgZXhlY0Z1bmMoKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoZS5jb2RlID09PSAwICYmIGUuc3Rkb3V0KSB7XG4gICAgICAgIHJldHVybiBlLnN0ZG91dC5yZXBsYWNlKExJTktFUl9XQVJOSU5HX1JFR0VYUCwgJycpLnRyaW0oKTtcbiAgICAgIH1cblxuICAgICAgaWYgKF8uaXNOdWxsKGUuY29kZSkpIHtcbiAgICAgICAgZS5tZXNzYWdlID0gYEVycm9yIGV4ZWN1dGluZyBhZGJFeGVjLiBPcmlnaW5hbCBlcnJvcjogJyR7ZS5tZXNzYWdlfScuIGAgK1xuICAgICAgICAgIGBUcnkgdG8gaW5jcmVhc2UgdGhlICR7b3B0cy50aW1lb3V0fW1zIGFkYiBleGVjdXRpb24gdGltZW91dCByZXByZXNlbnRlZCBieSAnJHtvcHRzLnRpbWVvdXRDYXBOYW1lfScgY2FwYWJpbGl0eWA7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlLm1lc3NhZ2UgPSBgRXJyb3IgZXhlY3V0aW5nIGFkYkV4ZWMuIE9yaWdpbmFsIGVycm9yOiAnJHtlLm1lc3NhZ2V9JzsgYCArXG4gICAgICAgICAgYFN0ZGVycjogJyR7KGUuc3RkZXJyIHx8ICcnKS50cmltKCl9JzsgQ29kZTogJyR7ZS5jb2RlfSdgO1xuICAgICAgfVxuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIGF3YWl0IGV4ZWNGdW5jKCk7XG59O1xuXG4vKipcbiAqIEB0eXBlZGVmIHtPYmplY3R9IFNoZWxsRXhlY09wdGlvbnNcbiAqIEBwcm9wZXJ0eSB7P3N0cmluZ30gdGltZW91dENhcE5hbWUgW2FkYkV4ZWNUaW1lb3V0XSAtIHRoZSBuYW1lIG9mIHRoZSBjb3JyZXNwb25kaW5nIEFwcGl1bSdzIHRpbWVvdXQgY2FwYWJpbGl0eVxuICogKHVzZWQgaW4gdGhlIGVycm9yIG1lc3NhZ2VzKS5cbiAqIEBwcm9wZXJ0eSB7P251bWJlcn0gdGltZW91dCBbYWRiRXhlY1RpbWVvdXRdIC0gY29tbWFuZCBleGVjdXRpb24gdGltZW91dC5cbiAqIEBwcm9wZXJ0eSB7P2Jvb2xlYW59IHByaXZpbGVnZWQgW2ZhbHN5XSAtIFdoZXRoZXIgdG8gcnVuIHRoZSBnaXZlbiBjb21tYW5kIGFzIHJvb3QuXG4gKiBAcHJvcGVydHkgez9ib29sZWFufSBrZWVwUHJpdmlsZWdlZCBbZmFsc3ldIC0gV2hldGhlciB0byBrZWVwIHJvb3QgbW9kZSBhZnRlciBjb21tYW5kIGV4ZWN1dGlvbiBpcyBjb21wbGV0ZWQuXG4gKlxuICogQWxsIG90aGVyIHByb3BlcnRpZXMgYXJlIHRoZSBzYW1lIGFzIGZvciBgZXhlY2AgY2FsbCBmcm9tIHtAbGluayBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL25vZGUtdGVlbl9wcm9jZXNzfVxuICogbW9kdWxlXG4gKi9cblxuLyoqXG4gKiBFeGVjdXRlIHRoZSBnaXZlbiBjb21tYW5kIHVzaW5nIF9hZGIgc2hlbGxfIHByZWZpeC5cbiAqXG4gKiBAcGFyYW0geyFBcnJheS48c3RyaW5nPnxzdHJpbmd9IGNtZCAtIFRoZSBhcnJheSBvZiByZXN0IGNvbW1hbmQgbGluZSBwYXJhbWV0ZXJzIG9yIGEgc2luZ2xlXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3RyaW5nIHBhcmFtZXRlci5cbiAqIEBwYXJhbSB7P1NoZWxsRXhlY09wdGlvbnN9IG9wdHMgW3t9XSAtIEFkZGl0aW9uYWwgb3B0aW9ucyBtYXBwaW5nLlxuICogQHJldHVybiB7c3RyaW5nfSAtIENvbW1hbmQncyBzdGRvdXQuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGNvbW1hbmQgcmV0dXJuZWQgbm9uLXplcm8gZXhpdCBjb2RlLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5zaGVsbCA9IGFzeW5jIGZ1bmN0aW9uIHNoZWxsIChjbWQsIG9wdHMgPSB7fSkge1xuICBjb25zdCB7XG4gICAgcHJpdmlsZWdlZCxcbiAgICBrZWVwUHJpdmlsZWdlZCxcbiAgfSA9IG9wdHM7XG5cbiAgLy8gSWYgdGhlIGNvbW1hbmQgcmVxdWlyZXMgcHJpdmlsZWdlcywgcm9vdCB0aGlzIGRldmljZVxuICBsZXQgc2hvdWxkUmVzdG9yZVVzZXIgPSBmYWxzZTtcbiAgaWYgKHByaXZpbGVnZWQpIHtcbiAgICBsb2cuaW5mbyhgJ2FkYiBzaGVsbCAke2NtZH0nIHJlcXVpcmVzIHJvb3QgYWNjZXNzLiBBdHRlbXB0aW5nIHRvIGdhaW4gcm9vdCBhY2Nlc3Mgbm93LmApO1xuICAgIGNvbnN0IHt3YXNBbHJlYWR5Um9vdGVkLCBpc1N1Y2Nlc3NmdWx9ID0gYXdhaXQgdGhpcy5yb290KCk7XG4gICAgc2hvdWxkUmVzdG9yZVVzZXIgPSAhd2FzQWxyZWFkeVJvb3RlZDtcbiAgICBpZiAod2FzQWxyZWFkeVJvb3RlZCkge1xuICAgICAgbG9nLmluZm8oJ0RldmljZSBhbHJlYWR5IGhhZCByb290IGFjY2VzcycpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsb2cuaW5mbyhpc1N1Y2Nlc3NmdWwgPyAnUm9vdCBhY2Nlc3Mgc3VjY2Vzc2Z1bGx5IGdhaW5lZCcgOiAnQ291bGQgbm90IGdhaW4gcm9vdCBhY2Nlc3MnKTtcbiAgICB9XG4gIH1cbiAgbGV0IGRpZENvbW1hbmRGYWlsID0gZmFsc2U7XG4gIHRyeSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFkYkV4ZWMoXy5pc0FycmF5KGNtZCkgPyBbJ3NoZWxsJywgLi4uY21kXSA6IFsnc2hlbGwnLCBjbWRdLCBvcHRzKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGRpZENvbW1hbmRGYWlsID0gdHJ1ZTtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH0gZmluYWxseSB7XG4gICAgLy8gUmV0dXJuIHRoZSAncm9vdCcgc3RhdGUgdG8gd2hhdCBpdCB3YXMgYmVmb3JlICdzaGVsbCcgd2FzIGNhbGxlZFxuICAgIGlmIChwcml2aWxlZ2VkICYmIHNob3VsZFJlc3RvcmVVc2VyICYmICgha2VlcFByaXZpbGVnZWQgfHwgZGlkQ29tbWFuZEZhaWwpKSB7XG4gICAgICBjb25zdCB7aXNTdWNjZXNzZnVsfSA9IGF3YWl0IHRoaXMudW5yb290KCk7XG4gICAgICBsb2cuZGVidWcoaXNTdWNjZXNzZnVsID8gJ1JldHVybmVkIGRldmljZSB0byB1bnJvb3RlZCBzdGF0ZScgOiAnQ291bGQgbm90IHJldHVybiBkZXZpY2UgdG8gdW5yb290ZWQgc3RhdGUnKTtcbiAgICB9XG4gIH1cbn07XG5cbnN5c3RlbUNhbGxNZXRob2RzLmNyZWF0ZVN1YlByb2Nlc3MgPSBmdW5jdGlvbiBjcmVhdGVTdWJQcm9jZXNzIChhcmdzID0gW10pIHtcbiAgLy8gYWRkIHRoZSBkZWZhdWx0IGFyZ3VtZW50c1xuICBhcmdzID0gdGhpcy5leGVjdXRhYmxlLmRlZmF1bHRBcmdzLmNvbmNhdChhcmdzKTtcbiAgbG9nLmRlYnVnKGBDcmVhdGluZyBBREIgc3VicHJvY2VzcyB3aXRoIGFyZ3M6ICR7SlNPTi5zdHJpbmdpZnkoYXJncyl9YCk7XG4gIHJldHVybiBuZXcgU3ViUHJvY2Vzcyh0aGlzLmdldEFkYlBhdGgoKSwgYXJncyk7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBjdXJyZW50IGFkYiBwb3J0LlxuICogQHRvZG8gY2FuIHByb2JhYmx5IGRlcHJlY2F0ZSB0aGlzIG5vdyB0aGF0IHRoZSBsb2dpYyBpcyBqdXN0IHRvIHJlYWQgdGhpcy5hZGJQb3J0XG4gKiBAcmV0dXJuIHtudW1iZXJ9IFRoZSBjdXJyZW50IGFkYiBwb3J0IG51bWJlci5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0QWRiU2VydmVyUG9ydCA9IGZ1bmN0aW9uIGdldEFkYlNlcnZlclBvcnQgKCkge1xuICByZXR1cm4gdGhpcy5hZGJQb3J0O1xufTtcblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgY3VycmVudCBlbXVsYXRvciBwb3J0IGZyb20gX2FkYiBkZXZpdmVzXyBvdXRwdXQuXG4gKlxuICogQHJldHVybiB7bnVtYmVyfSBUaGUgY3VycmVudCBlbXVsYXRvciBwb3J0LlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZXJlIGFyZSBubyBjb25uZWN0ZWQgZGV2aWNlcy5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0RW11bGF0b3JQb3J0ID0gYXN5bmMgZnVuY3Rpb24gZ2V0RW11bGF0b3JQb3J0ICgpIHtcbiAgbG9nLmRlYnVnKCdHZXR0aW5nIHJ1bm5pbmcgZW11bGF0b3IgcG9ydCcpO1xuICBpZiAodGhpcy5lbXVsYXRvclBvcnQgIT09IG51bGwpIHtcbiAgICByZXR1cm4gdGhpcy5lbXVsYXRvclBvcnQ7XG4gIH1cbiAgdHJ5IHtcbiAgICBsZXQgZGV2aWNlcyA9IGF3YWl0IHRoaXMuZ2V0Q29ubmVjdGVkRGV2aWNlcygpO1xuICAgIGxldCBwb3J0ID0gdGhpcy5nZXRQb3J0RnJvbUVtdWxhdG9yU3RyaW5nKGRldmljZXNbMF0udWRpZCk7XG4gICAgaWYgKHBvcnQpIHtcbiAgICAgIHJldHVybiBwb3J0O1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEVtdWxhdG9yIHBvcnQgbm90IGZvdW5kYCk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBObyBkZXZpY2VzIGNvbm5lY3RlZC4gT3JpZ2luYWwgZXJyb3I6ICR7ZS5tZXNzYWdlfWApO1xuICB9XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBjdXJyZW50IGVtdWxhdG9yIHBvcnQgYnkgcGFyc2luZyBlbXVsYXRvciBuYW1lIHN0cmluZy5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gZW1TdHIgLSBFbXVsYXRvciBuYW1lIHN0cmluZy5cbiAqIEByZXR1cm4ge251bWJlcnxib29sZWFufSBFaXRoZXIgdGhlIGN1cnJlbnQgZW11bGF0b3IgcG9ydCBvclxuICogICAgICAgICAgICAgICAgICAgICAgICAgIF9mYWxzZV8gaWYgcG9ydCBudW1iZXIgY2Fubm90IGJlIHBhcnNlZC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0UG9ydEZyb21FbXVsYXRvclN0cmluZyA9IGZ1bmN0aW9uIGdldFBvcnRGcm9tRW11bGF0b3JTdHJpbmcgKGVtU3RyKSB7XG4gIGxldCBwb3J0UGF0dGVybiA9IC9lbXVsYXRvci0oXFxkKykvO1xuICBpZiAocG9ydFBhdHRlcm4udGVzdChlbVN0cikpIHtcbiAgICByZXR1cm4gcGFyc2VJbnQocG9ydFBhdHRlcm4uZXhlYyhlbVN0cilbMV0sIDEwKTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59O1xuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBsaXN0IG9mIGN1cnJlbnRseSBjb25uZWN0ZWQgZW11bGF0b3JzLlxuICpcbiAqIEByZXR1cm4ge0FycmF5LjxEZXZpY2U+fSBUaGUgbGlzdCBvZiBjb25uZWN0ZWQgZGV2aWNlcy5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuZ2V0Q29ubmVjdGVkRW11bGF0b3JzID0gYXN5bmMgZnVuY3Rpb24gZ2V0Q29ubmVjdGVkRW11bGF0b3JzICgpIHtcbiAgbG9nLmRlYnVnKCdHZXR0aW5nIGNvbm5lY3RlZCBlbXVsYXRvcnMnKTtcbiAgdHJ5IHtcbiAgICBsZXQgZGV2aWNlcyA9IGF3YWl0IHRoaXMuZ2V0Q29ubmVjdGVkRGV2aWNlcygpO1xuICAgIGxldCBlbXVsYXRvcnMgPSBbXTtcbiAgICBmb3IgKGxldCBkZXZpY2Ugb2YgZGV2aWNlcykge1xuICAgICAgbGV0IHBvcnQgPSB0aGlzLmdldFBvcnRGcm9tRW11bGF0b3JTdHJpbmcoZGV2aWNlLnVkaWQpO1xuICAgICAgaWYgKHBvcnQpIHtcbiAgICAgICAgZGV2aWNlLnBvcnQgPSBwb3J0O1xuICAgICAgICBlbXVsYXRvcnMucHVzaChkZXZpY2UpO1xuICAgICAgfVxuICAgIH1cbiAgICBsb2cuZGVidWcoYCR7ZW11bGF0b3JzLmxlbmd0aH0gZW11bGF0b3IocykgY29ubmVjdGVkYCk7XG4gICAgcmV0dXJuIGVtdWxhdG9ycztcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3IgZ2V0dGluZyBlbXVsYXRvcnMuIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuLyoqXG4gKiBTZXQgX2VtdWxhdG9yUG9ydF8gcHJvcGVydHkgb2YgdGhlIGN1cnJlbnQgY2xhc3MuXG4gKlxuICogQHBhcmFtIHtudW1iZXJ9IGVtUG9ydCAtIFRoZSBlbXVsYXRvciBwb3J0IHRvIGJlIHNldC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuc2V0RW11bGF0b3JQb3J0ID0gZnVuY3Rpb24gc2V0RW11bGF0b3JQb3J0IChlbVBvcnQpIHtcbiAgdGhpcy5lbXVsYXRvclBvcnQgPSBlbVBvcnQ7XG59O1xuXG4vKipcbiAqIFNldCB0aGUgaWRlbnRpZmllciBvZiB0aGUgY3VycmVudCBkZXZpY2UgKF90aGlzLmN1ckRldmljZUlkXykuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IC0gVGhlIGRldmljZSBpZGVudGlmaWVyLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5zZXREZXZpY2VJZCA9IGZ1bmN0aW9uIHNldERldmljZUlkIChkZXZpY2VJZCkge1xuICBsb2cuZGVidWcoYFNldHRpbmcgZGV2aWNlIGlkIHRvICR7ZGV2aWNlSWR9YCk7XG4gIHRoaXMuY3VyRGV2aWNlSWQgPSBkZXZpY2VJZDtcbiAgbGV0IGFyZ3NIYXNEZXZpY2UgPSB0aGlzLmV4ZWN1dGFibGUuZGVmYXVsdEFyZ3MuaW5kZXhPZignLXMnKTtcbiAgaWYgKGFyZ3NIYXNEZXZpY2UgIT09IC0xKSB7XG4gICAgLy8gcmVtb3ZlIHRoZSBvbGQgZGV2aWNlIGlkIGZyb20gdGhlIGFyZ3VtZW50c1xuICAgIHRoaXMuZXhlY3V0YWJsZS5kZWZhdWx0QXJncy5zcGxpY2UoYXJnc0hhc0RldmljZSwgMik7XG4gIH1cbiAgdGhpcy5leGVjdXRhYmxlLmRlZmF1bHRBcmdzLnB1c2goJy1zJywgZGV2aWNlSWQpO1xufTtcblxuLyoqXG4gKiBTZXQgdGhlIHRoZSBjdXJyZW50IGRldmljZSBvYmplY3QuXG4gKlxuICogQHBhcmFtIHtEZXZpY2V9IGRldmljZU9iaiAtIFRoZSBkZXZpY2Ugb2JqZWN0IHRvIGJlIHNldC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuc2V0RGV2aWNlID0gZnVuY3Rpb24gc2V0RGV2aWNlIChkZXZpY2VPYmopIHtcbiAgbGV0IGRldmljZUlkID0gZGV2aWNlT2JqLnVkaWQ7XG4gIGxldCBlbVBvcnQgPSB0aGlzLmdldFBvcnRGcm9tRW11bGF0b3JTdHJpbmcoZGV2aWNlSWQpO1xuICB0aGlzLnNldEVtdWxhdG9yUG9ydChlbVBvcnQpO1xuICB0aGlzLnNldERldmljZUlkKGRldmljZUlkKTtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBvYmplY3QgZm9yIHRoZSBjdXJyZW50bHkgcnVubmluZyBlbXVsYXRvci5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gYXZkTmFtZSAtIEVtdWxhdG9yIG5hbWUuXG4gKiBAcmV0dXJuIHs/RGV2aWNlfSBDdXJyZW50bHkgcnVubmluZyBlbXVsYXRvciBvciBfbnVsbF8uXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmdldFJ1bm5pbmdBVkQgPSBhc3luYyBmdW5jdGlvbiBnZXRSdW5uaW5nQVZEIChhdmROYW1lKSB7XG4gIGxvZy5kZWJ1ZyhgVHJ5aW5nIHRvIGZpbmQgJyR7YXZkTmFtZX0nIGVtdWxhdG9yYCk7XG4gIHRyeSB7XG4gICAgY29uc3QgZW11bGF0b3JzID0gYXdhaXQgdGhpcy5nZXRDb25uZWN0ZWRFbXVsYXRvcnMoKTtcbiAgICBmb3IgKGNvbnN0IGVtdWxhdG9yIG9mIGVtdWxhdG9ycykge1xuICAgICAgdGhpcy5zZXRFbXVsYXRvclBvcnQoZW11bGF0b3IucG9ydCk7XG4gICAgICBjb25zdCBydW5uaW5nQVZETmFtZSA9IGF3YWl0IHRoaXMuc2VuZFRlbG5ldENvbW1hbmQoJ2F2ZCBuYW1lJyk7XG4gICAgICBpZiAoXy50b0xvd2VyKGF2ZE5hbWUpID09PSBfLnRvTG93ZXIocnVubmluZ0FWRE5hbWUpKSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhgRm91bmQgZW11bGF0b3IgJyR7YXZkTmFtZX0nIG9uIHBvcnQgJHtlbXVsYXRvci5wb3J0fWApO1xuICAgICAgICB0aGlzLnNldERldmljZUlkKGVtdWxhdG9yLnVkaWQpO1xuICAgICAgICByZXR1cm4gZW11bGF0b3I7XG4gICAgICB9XG4gICAgfVxuICAgIGxvZy5kZWJ1ZyhgRW11bGF0b3IgJyR7YXZkTmFtZX0nIG5vdCBydW5uaW5nYCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGdldHRpbmcgQVZELiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogR2V0IHRoZSBvYmplY3QgZm9yIHRoZSBjdXJyZW50bHkgcnVubmluZyBlbXVsYXRvci5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gYXZkTmFtZSAtIEVtdWxhdG9yIG5hbWUuXG4gKiBAcGFyYW0ge251bWJlcn0gdGltZW91dE1zIFsyMDAwMF0gLSBUaGUgbWF4aW11bSBudW1iZXIgb2YgbWlsbGlzZWNvbmRzXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0byB3YWl0IHVudGlsIGF0IGxlYXN0IG9uZSBydW5uaW5nIEFWRCBvYmplY3RcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlzIGRldGVjdGVkLlxuICogQHJldHVybiB7P0RldmljZX0gQ3VycmVudGx5IHJ1bm5pbmcgZW11bGF0b3Igb3IgX251bGxfLlxuICogQHRocm93cyB7RXJyb3J9IElmIG5vIGRldmljZSBoYXMgYmVlbiBkZXRlY3RlZCB3aXRoaW4gdGhlIHRpbWVvdXQuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmdldFJ1bm5pbmdBVkRXaXRoUmV0cnkgPSBhc3luYyBmdW5jdGlvbiBnZXRSdW5uaW5nQVZEV2l0aFJldHJ5IChhdmROYW1lLCB0aW1lb3V0TXMgPSAyMDAwMCkge1xuICBsZXQgcnVubmluZ0F2ZDtcbiAgdHJ5IHtcbiAgICBhd2FpdCB3YWl0Rm9yQ29uZGl0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJ1bm5pbmdBdmQgPSBhd2FpdCB0aGlzLmdldFJ1bm5pbmdBVkQoYXZkTmFtZS5yZXBsYWNlKCdAJywgJycpKTtcbiAgICAgICAgcmV0dXJuIHJ1bm5pbmdBdmQ7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhlLm1lc3NhZ2UpO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfSwge1xuICAgICAgd2FpdE1zOiB0aW1lb3V0TXMsXG4gICAgICBpbnRlcnZhbE1zOiAxMDAwLFxuICAgIH0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciBnZXR0aW5nIEFWRCB3aXRoIHJldHJ5LiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbiAgcmV0dXJuIHJ1bm5pbmdBdmQ7XG59O1xuXG4vKipcbiAqIFNodXRkb3duIGFsbCBydW5uaW5nIGVtdWxhdG9ycyBieSBraWxsaW5nIHRoZWlyIHByb2Nlc3Nlcy5cbiAqXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYga2lsbGluZyB0b29sIHJldHVybmVkIG5vbi16ZXJvIHJldHVybiBjb2RlLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5raWxsQWxsRW11bGF0b3JzID0gYXN5bmMgZnVuY3Rpb24ga2lsbEFsbEVtdWxhdG9ycyAoKSB7XG4gIGxldCBjbWQsIGFyZ3M7XG4gIGlmIChzeXN0ZW0uaXNXaW5kb3dzKCkpIHtcbiAgICBjbWQgPSAnVEFTS0tJTEwnO1xuICAgIGFyZ3MgPSBbJ1RBU0tLSUxMJywgJy9JTScsICdlbXVsYXRvci5leGUnXTtcbiAgfSBlbHNlIHtcbiAgICBjbWQgPSAnL3Vzci9iaW4va2lsbGFsbCc7XG4gICAgYXJncyA9IFsnLW0nLCAnZW11bGF0b3IqJ107XG4gIH1cbiAgdHJ5IHtcbiAgICBhd2FpdCBleGVjKGNtZCwgYXJncyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGtpbGxpbmcgZW11bGF0b3JzLiBPcmlnaW5hbCBlcnJvcjogJHtlLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogS2lsbCBlbXVsYXRvciB3aXRoIHRoZSBnaXZlbiBuYW1lLiBObyBlcnJvclxuICogaXMgdGhyb3duIGlzIGdpdmVuIGF2ZCBkb2VzIG5vdCBleGlzdC9pcyBub3QgcnVubmluZy5cbiAqXG4gKiBAcGFyYW0gez9zdHJpbmd9IGF2ZE5hbWUgLSBUaGUgbmFtZSBvZiB0aGUgZW11bGF0b3IgdG8gYmUga2lsbGVkLiBJZiBlbXB0eSxcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBjdXJyZW50IGVtdWxhdG9yIHdpbGwgYmUga2lsbGVkLlxuICogQHBhcmFtIHs/bnVtYmVyfSB0aW1lb3V0IFs2MDAwMF0gLSBUaGUgYW1vdW50IG9mIHRpbWUgdG8gd2FpdCBiZWZvcmUgdGhyb3dpbmdcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYW4gZXhjZXB0aW9uIGFib3V0IHVuc3VjY2Vzc2Z1bCBraWxsaW5nXG4gKiBAcmV0dXJuIHtib29sZWFufSAtIFRydWUgaWYgdGhlIGVtdWxhdG9yIHdhcyBraWxsZWQsIGZhbHNlIG90aGVyd2lzZS5cbiAqIEB0aHJvd3Mge0Vycm9yfSBpZiB0aGVyZSB3YXMgYSBmYWlsdXJlIGJ5IGtpbGxpbmcgdGhlIGVtdWxhdG9yXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmtpbGxFbXVsYXRvciA9IGFzeW5jIGZ1bmN0aW9uIGtpbGxFbXVsYXRvciAoYXZkTmFtZSA9IG51bGwsIHRpbWVvdXQgPSA2MDAwMCkge1xuICBpZiAodXRpbC5oYXNWYWx1ZShhdmROYW1lKSkge1xuICAgIGxvZy5kZWJ1ZyhgS2lsbGluZyBhdmQgJyR7YXZkTmFtZX0nYCk7XG4gICAgY29uc3QgZGV2aWNlID0gYXdhaXQgdGhpcy5nZXRSdW5uaW5nQVZEKGF2ZE5hbWUpO1xuICAgIGlmICghZGV2aWNlKSB7XG4gICAgICBsb2cuaW5mbyhgTm8gYXZkIHdpdGggbmFtZSAnJHthdmROYW1lfScgcnVubmluZy4gU2tpcHBpbmcga2lsbCBzdGVwLmApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBraWxsaW5nIHRoZSBjdXJyZW50IGF2ZFxuICAgIGxvZy5kZWJ1ZyhgS2lsbGluZyBhdmQgd2l0aCBpZCAnJHt0aGlzLmN1ckRldmljZUlkfSdgKTtcbiAgICBpZiAoIWF3YWl0IHRoaXMuaXNFbXVsYXRvckNvbm5lY3RlZCgpKSB7XG4gICAgICBsb2cuZGVidWcoYEVtdWxhdG9yIHdpdGggaWQgJyR7dGhpcy5jdXJEZXZpY2VJZH0nIG5vdCBjb25uZWN0ZWQuIFNraXBwaW5nIGtpbGwgc3RlcGApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydlbXUnLCAna2lsbCddKTtcbiAgbG9nLmRlYnVnKGBXYWl0aW5nIHVwIHRvICR7dGltZW91dH1tcyB1bnRpbCB0aGUgZW11bGF0b3IgJyR7YXZkTmFtZSA/IGF2ZE5hbWUgOiB0aGlzLmN1ckRldmljZUlkfScgaXMga2lsbGVkYCk7XG4gIHRyeSB7XG4gICAgYXdhaXQgd2FpdEZvckNvbmRpdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gdXRpbC5oYXNWYWx1ZShhdmROYW1lKVxuICAgICAgICAgID8gIWF3YWl0IHRoaXMuZ2V0UnVubmluZ0FWRChhdmROYW1lKVxuICAgICAgICAgIDogIWF3YWl0IHRoaXMuaXNFbXVsYXRvckNvbm5lY3RlZCgpO1xuICAgICAgfSBjYXRjaCAoaWduKSB7fVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0sIHtcbiAgICAgIHdhaXRNczogdGltZW91dCxcbiAgICAgIGludGVydmFsTXM6IDIwMDAsXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZSBlbXVsYXRvciAnJHthdmROYW1lID8gYXZkTmFtZSA6IHRoaXMuY3VyRGV2aWNlSWR9JyBpcyBzdGlsbCBydW5uaW5nIGFmdGVyIGJlaW5nIGtpbGxlZCAke3RpbWVvdXR9bXMgYWdvYCk7XG4gIH1cbiAgbG9nLmluZm8oYFN1Y2Nlc3NmdWxseSBraWxsZWQgdGhlICcke2F2ZE5hbWUgPyBhdmROYW1lIDogdGhpcy5jdXJEZXZpY2VJZH0nIGVtdWxhdG9yYCk7XG4gIHJldHVybiB0cnVlO1xufTtcblxuLyoqXG4gKiBTdGFydCBhbiBlbXVsYXRvciB3aXRoIGdpdmVuIHBhcmFtZXRlcnMgYW5kIHdhaXQgdW50aWwgaXQgaXMgZnVsbCBzdGFydGVkLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBhdmROYW1lIC0gVGhlIG5hbWUgb2YgYW4gZXhpc3RpbmcgZW11bGF0b3IuXG4gKiBAcGFyYW0ge0FycmF5LjxzdHJpbmc+fHN0cmluZ30gYXZkQXJncyAtIEFkZGl0aW9uYWwgZW11bGF0b3IgY29tbWFuZCBsaW5lIGFyZ3VtZW50LlxuICogQHBhcmFtIHs/c3RyaW5nfSBsYW5ndWFnZSAtIEVtdWxhdG9yIHN5c3RlbSBsYW5ndWFnZS5cbiAqIEBwYXJhbSB7P2NvdW50cnl9IGNvdW50cnkgLSBFbXVsYXRvciBzeXN0ZW0gY291bnRyeS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBhdmRMYXVuY2hUaW1lb3V0IFs2MDAwMF0gLSBFbXVsYXRvciBzdGFydHVwIHRpbWVvdXQgaW4gbWlsbGlzZWNvbmRzLlxuICogQHBhcmFtIHtudW1iZXJ9IHJldHJ5VGltZXMgWzFdIC0gVGhlIG1heGltdW0gbnVtYmVyIG9mIHN0YXJ0dXAgcmV0cmllcy5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgZW11bGF0b3IgZmFpbHMgdG8gc3RhcnQgd2l0aGluIHRoZSBnaXZlbiB0aW1lb3V0LlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5sYXVuY2hBVkQgPSBhc3luYyBmdW5jdGlvbiBsYXVuY2hBVkQgKGF2ZE5hbWUsIGF2ZEFyZ3MsIGxhbmd1YWdlLCBjb3VudHJ5LFxuICBhdmRMYXVuY2hUaW1lb3V0ID0gNjAwMDAsIGF2ZFJlYWR5VGltZW91dCA9IDYwMDAwLCByZXRyeVRpbWVzID0gMSkge1xuICBsb2cuZGVidWcoYExhdW5jaGluZyBFbXVsYXRvciB3aXRoIEFWRCAke2F2ZE5hbWV9LCBsYXVuY2hUaW1lb3V0IGAgK1xuICAgICAgICAgICAgYCR7YXZkTGF1bmNoVGltZW91dH1tcyBhbmQgcmVhZHlUaW1lb3V0ICR7YXZkUmVhZHlUaW1lb3V0fW1zYCk7XG4gIGxldCBlbXVsYXRvckJpbmFyeVBhdGggPSBhd2FpdCB0aGlzLmdldFNka0JpbmFyeVBhdGgoJ2VtdWxhdG9yJyk7XG4gIGlmIChhdmROYW1lWzBdID09PSAnQCcpIHtcbiAgICBhdmROYW1lID0gYXZkTmFtZS5zdWJzdHIoMSk7XG4gIH1cbiAgYXdhaXQgdGhpcy5jaGVja0F2ZEV4aXN0KGF2ZE5hbWUpO1xuICBsZXQgbGF1bmNoQXJncyA9IFsnLWF2ZCcsIGF2ZE5hbWVdO1xuICBpZiAoXy5pc1N0cmluZyhsYW5ndWFnZSkpIHtcbiAgICBsb2cuZGVidWcoYFNldHRpbmcgQW5kcm9pZCBEZXZpY2UgTGFuZ3VhZ2UgdG8gJHtsYW5ndWFnZX1gKTtcbiAgICBsYXVuY2hBcmdzLnB1c2goJy1wcm9wJywgYHBlcnNpc3Quc3lzLmxhbmd1YWdlPSR7bGFuZ3VhZ2UudG9Mb3dlckNhc2UoKX1gKTtcbiAgfVxuICBpZiAoXy5pc1N0cmluZyhjb3VudHJ5KSkge1xuICAgIGxvZy5kZWJ1ZyhgU2V0dGluZyBBbmRyb2lkIERldmljZSBDb3VudHJ5IHRvICR7Y291bnRyeX1gKTtcbiAgICBsYXVuY2hBcmdzLnB1c2goJy1wcm9wJywgYHBlcnNpc3Quc3lzLmNvdW50cnk9JHtjb3VudHJ5LnRvVXBwZXJDYXNlKCl9YCk7XG4gIH1cbiAgbGV0IGxvY2FsZTtcbiAgaWYgKF8uaXNTdHJpbmcobGFuZ3VhZ2UpICYmIF8uaXNTdHJpbmcoY291bnRyeSkpIHtcbiAgICBsb2NhbGUgPSBsYW5ndWFnZS50b0xvd2VyQ2FzZSgpICsgJy0nICsgY291bnRyeS50b1VwcGVyQ2FzZSgpO1xuICB9IGVsc2UgaWYgKF8uaXNTdHJpbmcobGFuZ3VhZ2UpKSB7XG4gICAgbG9jYWxlID0gbGFuZ3VhZ2UudG9Mb3dlckNhc2UoKTtcbiAgfSBlbHNlIGlmIChfLmlzU3RyaW5nKGNvdW50cnkpKSB7XG4gICAgbG9jYWxlID0gY291bnRyeTtcbiAgfVxuICBpZiAoXy5pc1N0cmluZyhsb2NhbGUpKSB7XG4gICAgbG9nLmRlYnVnKGBTZXR0aW5nIEFuZHJvaWQgRGV2aWNlIExvY2FsZSB0byAke2xvY2FsZX1gKTtcbiAgICBsYXVuY2hBcmdzLnB1c2goJy1wcm9wJywgYHBlcnNpc3Quc3lzLmxvY2FsZT0ke2xvY2FsZX1gKTtcbiAgfVxuICBpZiAoIV8uaXNFbXB0eShhdmRBcmdzKSkge1xuICAgIGxhdW5jaEFyZ3MucHVzaCguLi4oXy5pc0FycmF5KGF2ZEFyZ3MpID8gYXZkQXJncyA6IGF2ZEFyZ3Muc3BsaXQoJyAnKSkpO1xuICB9XG4gIGxvZy5kZWJ1ZyhgUnVubmluZyAnJHtlbXVsYXRvckJpbmFyeVBhdGh9JyB3aXRoIGFyZ3M6ICR7SlNPTi5zdHJpbmdpZnkobGF1bmNoQXJncyl9YCk7XG4gIGxldCBwcm9jID0gbmV3IFN1YlByb2Nlc3MoZW11bGF0b3JCaW5hcnlQYXRoLCBsYXVuY2hBcmdzKTtcbiAgYXdhaXQgcHJvYy5zdGFydCgwKTtcbiAgcHJvYy5vbignb3V0cHV0JywgKHN0ZG91dCwgc3RkZXJyKSA9PiB7XG4gICAgZm9yIChsZXQgbGluZSBvZiAoc3Rkb3V0IHx8IHN0ZGVyciB8fCAnJykuc3BsaXQoJ1xcbicpLmZpbHRlcihCb29sZWFuKSkge1xuICAgICAgbG9nLmluZm8oYFtBVkQgT1VUUFVUXSAke2xpbmV9YCk7XG4gICAgfVxuICB9KTtcbiAgcHJvYy5vbignZGllJywgKGNvZGUsIHNpZ25hbCkgPT4ge1xuICAgIGxvZy53YXJuKGBFbXVsYXRvciBhdmQgJHthdmROYW1lfSBleGl0ZWQgd2l0aCBjb2RlICR7Y29kZX0ke3NpZ25hbCA/IGAsIHNpZ25hbCAke3NpZ25hbH1gIDogJyd9YCk7XG4gIH0pO1xuICBhd2FpdCByZXRyeShyZXRyeVRpbWVzLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmdldFJ1bm5pbmdBVkRXaXRoUmV0cnkoYXZkTmFtZSwgYXZkTGF1bmNoVGltZW91dCkpO1xuICBhd2FpdCB0aGlzLndhaXRGb3JFbXVsYXRvclJlYWR5KGF2ZFJlYWR5VGltZW91dCk7XG4gIHJldHVybiBwcm9jO1xufTtcblxuLyoqXG4gKiBAdHlwZWRlZiB7T2JqZWN0fSBBREJWZXJzaW9uXG4gKiBAcHJvcGVydHkge3N0cmluZ30gdmVyc2lvblN0cmluZyAtIEFEQiB2ZXJzaW9uIGFzIGEgc3RyaW5nLlxuICogQHByb3BlcnR5IHtmbG9hdH0gdmVyc2lvbkZsb2F0IC0gVmVyc2lvbiBudW1iZXIgYXMgZmxvYXQgdmFsdWUgKHVzZWZ1bCBmb3IgY29tcGFyaXNvbikuXG4gKiBAcHJvcGVydHkge251bWJlcn0gbWFqb3IgLSBNYWpvciB2ZXJzaW9uIG51bWJlci5cbiAqIEBwcm9wZXJ0eSB7bnVtYmVyfSBtaW5vciAtIE1pbm9yIHZlcnNpb24gbnVtYmVyLlxuICogQHByb3BlcnR5IHtudW1iZXJ9IHBhdGNoIC0gUGF0Y2ggdmVyc2lvbiBudW1iZXIuXG4gKi9cblxuLyoqXG4gKiBHZXQgdGhlIGFkYiB2ZXJzaW9uLiBUaGUgcmVzdWx0IG9mIHRoaXMgbWV0aG9kIGlzIGNhY2hlZC5cbiAqXG4gKiBAcmV0dXJuIHtBREJWZXJzaW9ufSBUaGUgY3VycmVudCBhZGIgdmVyc2lvbi5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiBpdCBpcyBub3QgcG9zc2libGUgdG8gcGFyc2UgYWRiIHZlcnNpb24uXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmdldEFkYlZlcnNpb24gPSBfLm1lbW9pemUoYXN5bmMgZnVuY3Rpb24gZ2V0QWRiVmVyc2lvbiAoKSB7XG4gIHRyeSB7XG4gICAgbGV0IGFkYlZlcnNpb24gPSAoYXdhaXQgdGhpcy5hZGJFeGVjKCd2ZXJzaW9uJykpXG4gICAgICAucmVwbGFjZSgvQW5kcm9pZFxcc0RlYnVnXFxzQnJpZGdlXFxzdmVyc2lvblxccyhbXFxkLl0qKVtcXHNcXHctXSovLCAnJDEnKTtcbiAgICBsZXQgcGFydHMgPSBhZGJWZXJzaW9uLnNwbGl0KCcuJyk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHZlcnNpb25TdHJpbmc6IGFkYlZlcnNpb24sXG4gICAgICB2ZXJzaW9uRmxvYXQ6IHBhcnNlRmxvYXQoYWRiVmVyc2lvbiksXG4gICAgICBtYWpvcjogcGFyc2VJbnQocGFydHNbMF0sIDEwKSxcbiAgICAgIG1pbm9yOiBwYXJzZUludChwYXJ0c1sxXSwgMTApLFxuICAgICAgcGF0Y2g6IHBhcnRzWzJdID8gcGFyc2VJbnQocGFydHNbMl0sIDEwKSA6IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciBnZXR0aW5nIGFkYiB2ZXJzaW9uLiBPcmlnaW5hbCBlcnJvcjogJyR7ZS5tZXNzYWdlfSc7IGAgK1xuICAgICAgICAgICAgICAgICAgICAgICAgYFN0ZGVycjogJyR7KGUuc3RkZXJyIHx8ICcnKS50cmltKCl9JzsgQ29kZTogJyR7ZS5jb2RlfSdgKTtcbiAgfVxufSk7XG5cbi8qKlxuICogQ2hlY2sgaWYgZ2l2ZW4gZW11bGF0b3IgZXhpc3RzIGluIHRoZSBsaXN0IG9mIGF2YWlsYWJsZSBhdmRzLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBhdmROYW1lIC0gVGhlIG5hbWUgb2YgZW11bGF0b3IgdG8gdmVyaWZ5IGZvciBleGlzdGVuY2UuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGVtdWxhdG9yIHdpdGggZ2l2ZW4gbmFtZSBkb2VzIG5vdCBleGlzdC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuY2hlY2tBdmRFeGlzdCA9IGFzeW5jIGZ1bmN0aW9uIGNoZWNrQXZkRXhpc3QgKGF2ZE5hbWUpIHtcbiAgbGV0IGNtZCwgcmVzdWx0O1xuICB0cnkge1xuICAgIGNtZCA9IGF3YWl0IHRoaXMuZ2V0U2RrQmluYXJ5UGF0aCgnZW11bGF0b3InKTtcbiAgICByZXN1bHQgPSBhd2FpdCBleGVjKGNtZCwgWyctbGlzdC1hdmRzJ10pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgbGV0IHVua25vd25PcHRpb25FcnJvciA9IG5ldyBSZWdFeHAoJ3Vua25vd24gb3B0aW9uOiAtbGlzdC1hdmRzJywgJ2knKS50ZXN0KGUuc3RkZXJyKTtcbiAgICBpZiAoIXVua25vd25PcHRpb25FcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciBleGVjdXRpbmcgY2hlY2tBdmRFeGlzdC4gT3JpZ2luYWwgZXJyb3I6ICcke2UubWVzc2FnZX0nOyBgICtcbiAgICAgICAgICAgICAgICAgICAgICBgU3RkZXJyOiAnJHsoZS5zdGRlcnIgfHwgJycpLnRyaW0oKX0nOyBDb2RlOiAnJHtlLmNvZGV9J2ApO1xuXG4gICAgfVxuICAgIGNvbnN0IHNka1ZlcnNpb24gPSBhd2FpdCBnZXRTZGtUb29sc1ZlcnNpb24oKTtcbiAgICBsZXQgYmluYXJ5TmFtZSA9ICdhbmRyb2lkJztcbiAgICBpZiAoc2RrVmVyc2lvbikge1xuICAgICAgaWYgKHNka1ZlcnNpb24ubWFqb3IgPj0gMjUpIHtcbiAgICAgICAgYmluYXJ5TmFtZSA9ICdhdmRtYW5hZ2VyJztcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbG9nLndhcm4oYERlZmF1bHRpbmcgYmluYXJ5IG5hbWUgdG8gJyR7YmluYXJ5TmFtZX0nLCBiZWNhdXNlIFNESyB2ZXJzaW9uIGNhbm5vdCBiZSBwYXJzZWRgKTtcbiAgICB9XG4gICAgLy8gSWYgLWxpc3QtYXZkcyBvcHRpb24gaXMgbm90IGF2YWlsYWJsZSwgdXNlIGFuZHJvaWQgY29tbWFuZCBhcyBhbiBhbHRlcm5hdGl2ZVxuICAgIGNtZCA9IGF3YWl0IHRoaXMuZ2V0U2RrQmluYXJ5UGF0aChiaW5hcnlOYW1lKTtcbiAgICByZXN1bHQgPSBhd2FpdCBleGVjKGNtZCwgWydsaXN0JywgJ2F2ZCcsICctYyddKTtcbiAgfVxuICBpZiAocmVzdWx0LnN0ZG91dC5pbmRleE9mKGF2ZE5hbWUpID09PSAtMSkge1xuICAgIGxldCBleGlzdGluZ3MgPSBgKCR7cmVzdWx0LnN0ZG91dC50cmltKCkucmVwbGFjZSgvW1xcbl0vZywgJyksICgnKX0pYDtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEF2ZCAnJHthdmROYW1lfScgaXMgbm90IGF2YWlsYWJsZS4gcGxlYXNlIHNlbGVjdCB5b3VyIGF2ZCBuYW1lIGZyb20gb25lIG9mIHRoZXNlOiAnJHtleGlzdGluZ3N9J2ApO1xuICB9XG59O1xuXG4vKipcbiAqIENoZWNrIGlmIHRoZSBjdXJyZW50IGVtdWxhdG9yIGlzIHJlYWR5IHRvIGFjY2VwdCBmdXJ0aGVyIGNvbW1hbmRzIChib290aW5nIGNvbXBsZXRlZCkuXG4gKlxuICogQHBhcmFtIHtudW1iZXJ9IHRpbWVvdXRNcyBbMjAwMDBdIC0gVGhlIG1heGltdW0gbnVtYmVyIG9mIG1pbGxpc2Vjb25kcyB0byB3YWl0LlxuICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBlbXVsYXRvciBpcyBub3QgcmVhZHkgd2l0aGluIHRoZSBnaXZlbiB0aW1lb3V0LlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy53YWl0Rm9yRW11bGF0b3JSZWFkeSA9IGFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JFbXVsYXRvclJlYWR5ICh0aW1lb3V0TXMgPSAyMDAwMCkge1xuICB0cnkge1xuICAgIGF3YWl0IHdhaXRGb3JDb25kaXRpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKCEoYXdhaXQgdGhpcy5zaGVsbChbJ2dldHByb3AnLCAnaW5pdC5zdmMuYm9vdGFuaW0nXSkpLmluY2x1ZGVzKCdzdG9wcGVkJykpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgLy8gU29tZXRpbWVzIHRoZSBwYWNrYWdlIG1hbmFnZXIgc2VydmljZSBtaWdodCBzdGlsbCBiZWluZyBpbml0aWFsaXplZFxuICAgICAgICAvLyBvbiBzbG93IHN5c3RlbXMgZXZlbiBhZnRlciBlbXVsYXRvciBib290aW5nIGlzIGNvbXBsZXRlZC5cbiAgICAgICAgLy8gVGhlIHVzdWFsIG91dHB1dCBvZiBgcG0gZ2V0LWluc3RhbGwtbG9jYXRpb25gIGNvbW1hbmQgbG9va3MgbGlrZSBgMFthdXRvXWBcbiAgICAgICAgcmV0dXJuIC9cXGQrXFxbXFx3K1xcXS8udGVzdChhd2FpdCB0aGlzLnNoZWxsKFsncG0nLCAnZ2V0LWluc3RhbGwtbG9jYXRpb24nXSkpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZy5kZWJ1ZyhgV2FpdGluZyBmb3IgZW11bGF0b3Igc3RhcnR1cC4gSW50ZXJtZWRpYXRlIGVycm9yOiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfSwge1xuICAgICAgd2FpdE1zOiB0aW1lb3V0TXMsXG4gICAgICBpbnRlcnZhbE1zOiAzMDAwLFxuICAgIH0pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFbXVsYXRvciBpcyBub3QgcmVhZHkgd2l0aGluICR7dGltZW91dE1zfW1zYCk7XG4gIH1cbn07XG5cbi8qKlxuICogQ2hlY2sgaWYgdGhlIGN1cnJlbnQgZGV2aWNlIGlzIHJlYWR5IHRvIGFjY2VwdCBmdXJ0aGVyIGNvbW1hbmRzIChib290aW5nIGNvbXBsZXRlZCkuXG4gKlxuICogQHBhcmFtIHtudW1iZXJ9IGFwcERldmljZVJlYWR5VGltZW91dCBbMzBdIC0gVGhlIG1heGltdW0gbnVtYmVyIG9mIHNlY29uZHMgdG8gd2FpdC5cbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgZGV2aWNlIGlzIG5vdCByZWFkeSB3aXRoaW4gdGhlIGdpdmVuIHRpbWVvdXQuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLndhaXRGb3JEZXZpY2UgPSBhc3luYyBmdW5jdGlvbiB3YWl0Rm9yRGV2aWNlIChhcHBEZXZpY2VSZWFkeVRpbWVvdXQgPSAzMCkge1xuICB0aGlzLmFwcERldmljZVJlYWR5VGltZW91dCA9IGFwcERldmljZVJlYWR5VGltZW91dDtcbiAgY29uc3QgcmV0cmllcyA9IDM7XG4gIGNvbnN0IHRpbWVvdXQgPSBwYXJzZUludCh0aGlzLmFwcERldmljZVJlYWR5VGltZW91dCwgMTApIC8gcmV0cmllcyAqIDEwMDA7XG4gIGF3YWl0IHJldHJ5KHJldHJpZXMsIGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hZGJFeGVjKCd3YWl0LWZvci1kZXZpY2UnLCB7dGltZW91dH0pO1xuICAgICAgYXdhaXQgdGhpcy5waW5nKCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgYXdhaXQgdGhpcy5yZXN0YXJ0QWRiKCk7XG4gICAgICBhd2FpdCB0aGlzLmdldENvbm5lY3RlZERldmljZXMoKTtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRXJyb3Igd2FpdGluZyBmb3IgdGhlIGRldmljZSB0byBiZSBhdmFpbGFibGUuIE9yaWdpbmFsIGVycm9yOiAnJHtlLm1lc3NhZ2V9J2ApO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vKipcbiAqIFJlYm9vdCB0aGUgY3VycmVudCBkZXZpY2UgYW5kIHdhaXQgdW50aWwgaXQgaXMgY29tcGxldGVkLlxuICpcbiAqIEBwYXJhbSB7bnVtYmVyfSByZXRyaWVzIFtERUZBVUxUX0FEQl9SRUJPT1RfUkVUUklFU10gLSBUaGUgbWF4aW11bSBudW1iZXIgb2YgcmVib290IHJldHJpZXMuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGRldmljZSBmYWlsZWQgdG8gcmVib290IGFuZCBudW1iZXIgb2YgcmV0cmllcyBpcyBleGNlZWRlZC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMucmVib290ID0gYXN5bmMgZnVuY3Rpb24gcmVib290IChyZXRyaWVzID0gREVGQVVMVF9BREJfUkVCT09UX1JFVFJJRVMpIHtcbiAgLy8gR2V0IHJvb3QgYWNjZXNzIHNvIHdlIGNhbiBydW4gdGhlIG5leHQgc2hlbGwgY29tbWFuZHMgd2hpY2ggcmVxdWlyZSByb290IGFjY2Vzc1xuICBjb25zdCB7IHdhc0FscmVhZHlSb290ZWQgfSA9IGF3YWl0IHRoaXMucm9vdCgpO1xuICB0cnkge1xuICAgIC8vIFN0b3AgYW5kIHJlLXN0YXJ0IHRoZSBkZXZpY2VcbiAgICBhd2FpdCB0aGlzLnNoZWxsKFsnc3RvcCddKTtcbiAgICBhd2FpdCBCLmRlbGF5KDIwMDApOyAvLyBsZXQgdGhlIGVtdSBmaW5pc2ggc3RvcHBpbmc7XG4gICAgYXdhaXQgdGhpcy5zZXREZXZpY2VQcm9wZXJ0eSgnc3lzLmJvb3RfY29tcGxldGVkJywgMCwge1xuICAgICAgcHJpdmlsZWdlZDogZmFsc2UgLy8gbm8gbmVlZCB0byBzZXQgcHJpdmlsZWdlZCB0cnVlIGJlY2F1c2UgZGV2aWNlIGFscmVhZHkgcm9vdGVkXG4gICAgfSk7XG4gICAgYXdhaXQgdGhpcy5zaGVsbChbJ3N0YXJ0J10pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc3Qge21lc3NhZ2V9ID0gZTtcblxuICAgIC8vIHByb3ZpZGUgYSBoZWxwZnVsIGVycm9yIG1lc3NhZ2UgaWYgdGhlIHJlYXNvbiByZWJvb3QgZmFpbGVkIHdhcyBiZWNhdXNlIEFEQiBjb3VsZG4ndCBnYWluIHJvb3QgYWNjZXNzXG4gICAgaWYgKG1lc3NhZ2UuaW5jbHVkZXMoJ211c3QgYmUgcm9vdCcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCByZWJvb3QgZGV2aWNlLiBSZWJvb3RpbmcgcmVxdWlyZXMgcm9vdCBhY2Nlc3MgYW5kIGAgK1xuICAgICAgICBgYXR0ZW1wdCB0byBnZXQgcm9vdCBhY2Nlc3Mgb24gZGV2aWNlIGZhaWxlZCB3aXRoIGVycm9yOiAnJHttZXNzYWdlfSdgKTtcbiAgICB9XG4gICAgdGhyb3cgZTtcbiAgfSBmaW5hbGx5IHtcbiAgICAvLyBSZXR1cm4gcm9vdCBzdGF0ZSB0byB3aGF0IGl0IHdhcyBiZWZvcmVcbiAgICBpZiAoIXdhc0FscmVhZHlSb290ZWQpIHtcbiAgICAgIGF3YWl0IHRoaXMudW5yb290KCk7XG4gICAgfVxuICB9XG4gIGNvbnN0IHN0YXJ0ZWQgPSBwcm9jZXNzLmhydGltZSgpO1xuICBhd2FpdCByZXRyeUludGVydmFsKHJldHJpZXMsIDEwMDAsIGFzeW5jICgpID0+IHtcbiAgICBpZiAoKGF3YWl0IHRoaXMuZ2V0RGV2aWNlUHJvcGVydHkoJ3N5cy5ib290X2NvbXBsZXRlZCcpKSA9PT0gJzEnKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIHdlIGRvbid0IHdhbnQgdGhlIHN0YWNrIHRyYWNlLCBzbyBubyBsb2cuZXJyb3JBbmRUaHJvd1xuICAgIGNvbnN0IG1zZyA9IGBSZWJvb3QgaXMgbm90IGNvbXBsZXRlZCBhZnRlciAke3Byb2Nlc3MuaHJ0aW1lKHN0YXJ0ZWQpWzBdfXNgO1xuICAgIGxvZy5kZWJ1Zyhtc2cpO1xuICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICB9KTtcbn07XG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gcm9vdFJlc3VsdFxuICogQHByb3BlcnR5IHtib29sZWFufSBpc1N1Y2Nlc3NmdWwgVHJ1ZSBpZiB0aGUgY2FsbCB0byByb290L3Vucm9vdCB3YXMgc3VjY2Vzc2Z1bFxuICogQHByb3BlcnR5IHtib29sZWFufSB3YXNBbHJlYWR5Um9vdGVkIFRydWUgaWYgdGhlIGRldmljZSB3YXMgYWxyZWFkeSByb290ZWRcbiAqL1xuXG4vKipcbiAqIFN3aXRjaCBhZGIgc2VydmVyIHJvb3QgcHJpdmlsZWdlcy5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gaXNFbGV2YXRlZCAtIFNob3VsZCB3ZSBlbGV2YXRlIHRvIHRvIHJvb3Qgb3IgdW5yb290PyAoZGVmYXVsdCB0cnVlKVxuICogQHJldHVybiB7cm9vdFJlc3VsdH1cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuY2hhbmdlVXNlclByaXZpbGVnZXMgPSBhc3luYyBmdW5jdGlvbiBjaGFuZ2VVc2VyUHJpdmlsZWdlcyAoaXNFbGV2YXRlZCkge1xuICBjb25zdCBjbWQgPSBpc0VsZXZhdGVkID8gJ3Jvb3QnIDogJ3Vucm9vdCc7XG5cbiAgLy8gSWYgaXQncyBhbHJlYWR5IHJvb3RlZCwgb3VyIGpvYiBpcyBkb25lLiBObyBuZWVkIHRvIHJvb3QgaXQgYWdhaW4uXG4gIGNvbnN0IGlzUm9vdCA9IGF3YWl0IHRoaXMuaXNSb290KCk7XG4gIGlmICgoaXNSb290ICYmIGlzRWxldmF0ZWQpIHx8ICghaXNSb290ICYmICFpc0VsZXZhdGVkKSkge1xuICAgIHJldHVybiB7aXNTdWNjZXNzZnVsOiB0cnVlLCB3YXNBbHJlYWR5Um9vdGVkOiBpc1Jvb3R9O1xuICB9XG5cbiAgbGV0IHdhc0FscmVhZHlSb290ZWQgPSBpc1Jvb3Q7XG4gIHRyeSB7XG4gICAgbGV0IHtzdGRvdXR9ID0gYXdhaXQgZXhlYyh0aGlzLmV4ZWN1dGFibGUucGF0aCwgW2NtZF0pO1xuXG4gICAgLy8gb24gcmVhbCBkZXZpY2VzIGluIHNvbWUgc2l0dWF0aW9ucyB3ZSBnZXQgYW4gZXJyb3IgaW4gdGhlIHN0ZG91dFxuICAgIGlmIChzdGRvdXQpIHtcbiAgICAgIGlmIChzdGRvdXQuaW5jbHVkZXMoJ2FkYmQgY2Fubm90IHJ1biBhcyByb290JykpIHtcbiAgICAgICAgcmV0dXJuIHtpc1N1Y2Nlc3NmdWw6IGZhbHNlLCB3YXNBbHJlYWR5Um9vdGVkfTtcbiAgICAgIH1cbiAgICAgIC8vIGlmIHRoZSBkZXZpY2Ugd2FzIGFscmVhZHkgcm9vdGVkLCByZXR1cm4gdGhhdCBpbiB0aGUgcmVzdWx0XG4gICAgICBpZiAoc3Rkb3V0LmluY2x1ZGVzKCdhbHJlYWR5IHJ1bm5pbmcgYXMgcm9vdCcpKSB7XG4gICAgICAgIHdhc0FscmVhZHlSb290ZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4ge2lzU3VjY2Vzc2Z1bDogdHJ1ZSwgd2FzQWxyZWFkeVJvb3RlZH07XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnN0IHtzdGRlcnIgPSAnJywgbWVzc2FnZX0gPSBlcnI7XG4gICAgbG9nLndhcm4oYFVuYWJsZSB0byAke2NtZH0gYWRiIGRhZW1vbi4gT3JpZ2luYWwgZXJyb3I6ICcke21lc3NhZ2V9Jy4gU3RkZXJyOiAnJHtzdGRlcnJ9Jy4gQ29udGludWluZy5gKTtcblxuICAgIC8vIENoZWNrIHRoZSBvdXRwdXQgb2YgdGhlIHN0ZEVyciB0byBzZWUgaWYgdGhlcmUncyBhbnkgY2x1ZXMgdGhhdCBzaG93IHRoYXQgdGhlIGRldmljZSB3ZW50IG9mZmxpbmVcbiAgICAvLyBhbmQgaWYgaXQgZGlkIGdvIG9mZmxpbmUsIHJlc3RhcnQgQURCXG4gICAgaWYgKFsnY2xvc2VkJywgJ2RldmljZSBvZmZsaW5lJ10uaW5jbHVkZXMoKHgpID0+IHN0ZGVyci50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHgpKSkge1xuICAgICAgbG9nLndhcm4oYEF0dGVtcHQgdG8gJ2FkYiAke2NtZH0nIGNhdXNlZCBkZXZpY2UgdG8gZ28gb2ZmbGluZS4gUmVzdGFydGluZyBhZGIuYCk7XG4gICAgICBhd2FpdCB0aGlzLnJlc3RhcnRBZGIoKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge2lzU3VjY2Vzc2Z1bDogZmFsc2UsIHdhc0FscmVhZHlSb290ZWR9O1xuICB9XG59O1xuXG4vKipcbiAqIFN3aXRjaCBhZGIgc2VydmVyIHRvIHJvb3QgbW9kZVxuICogQHJldHVybiB7cm9vdFJlc3VsdH1cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMucm9vdCA9IGFzeW5jIGZ1bmN0aW9uIHJvb3QgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5jaGFuZ2VVc2VyUHJpdmlsZWdlcyh0cnVlKTtcbn07XG5cbi8qKlxuICogU3dpdGNoIGFkYiBzZXJ2ZXIgdG8gbm9uLXJvb3QgbW9kZS5cbiAqXG4gKiBAcmV0dXJuIHtyb290UmVzdWx0fVxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy51bnJvb3QgPSBhc3luYyBmdW5jdGlvbiB1bnJvb3QgKCkge1xuICByZXR1cm4gYXdhaXQgdGhpcy5jaGFuZ2VVc2VyUHJpdmlsZWdlcyhmYWxzZSk7XG59O1xuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIHRoZSBjdXJyZW50IHVzZXIgaXMgcm9vdFxuICpcbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgdGhlIHVzZXIgaXMgcm9vdFxuICogQHRocm93cyB7RXJyb3J9IGlmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSBpZGVudGlmeWluZ1xuICogdGhlIHVzZXIuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmlzUm9vdCA9IGFzeW5jIGZ1bmN0aW9uIGlzUm9vdCAoKSB7XG4gIHJldHVybiAoYXdhaXQgdGhpcy5zaGVsbChbJ3dob2FtaSddKSkudHJpbSgpID09PSAncm9vdCc7XG59O1xuXG4vKipcbiAqIFZlcmlmeSB3aGV0aGVyIGEgcmVtb3RlIHBhdGggZXhpc3RzIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVtb3RlUGF0aCAtIFRoZSByZW1vdGUgcGF0aCB0byB2ZXJpZnkuXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSBnaXZlbiBwYXRoIGV4aXN0cyBvbiB0aGUgZGV2aWNlLlxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5maWxlRXhpc3RzID0gYXN5bmMgZnVuY3Rpb24gZmlsZUV4aXN0cyAocmVtb3RlUGF0aCkge1xuICBsZXQgZmlsZXMgPSBhd2FpdCB0aGlzLmxzKHJlbW90ZVBhdGgpO1xuICByZXR1cm4gZmlsZXMubGVuZ3RoID4gMDtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBvdXRwdXQgb2YgX2xzXyBjb21tYW5kIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVtb3RlUGF0aCAtIFRoZSByZW1vdGUgcGF0aCAodGhlIGZpcnN0IGFyZ3VtZW50IHRvIHRoZSBfbHNfIGNvbW1hbmQpLlxuICogQHBhcmFtIHtBcnJheS48U3RyaW5nPn0gb3B0cyBbW11dIC0gQWRkaXRpb25hbCBfbHNfIG9wdGlvbnMuXG4gKiBAcmV0dXJuIHtBcnJheS48U3RyaW5nPn0gVGhlIF9sc18gb3V0cHV0IGFzIGFuIGFycmF5IG9mIHNwbGl0IGxpbmVzLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgIEFuIGVtcHR5IGFycmF5IGlzIHJldHVybmVkIG9mIHRoZSBnaXZlbiBfcmVtb3RlUGF0aF9cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICBkb2VzIG5vdCBleGlzdC5cbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMubHMgPSBhc3luYyBmdW5jdGlvbiBscyAocmVtb3RlUGF0aCwgb3B0cyA9IFtdKSB7XG4gIHRyeSB7XG4gICAgbGV0IGFyZ3MgPSBbJ2xzJywgLi4ub3B0cywgcmVtb3RlUGF0aF07XG4gICAgbGV0IHN0ZG91dCA9IGF3YWl0IHRoaXMuc2hlbGwoYXJncyk7XG4gICAgbGV0IGxpbmVzID0gc3Rkb3V0LnNwbGl0KCdcXG4nKTtcbiAgICByZXR1cm4gbGluZXMubWFwKChsKSA9PiBsLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5maWx0ZXIoKGwpID0+IGwuaW5kZXhPZignTm8gc3VjaCBmaWxlJykgPT09IC0xKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgaWYgKGVyci5tZXNzYWdlLmluZGV4T2YoJ05vIHN1Y2ggZmlsZSBvciBkaXJlY3RvcnknKSA9PT0gLTEpIHtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gICAgcmV0dXJuIFtdO1xuICB9XG59O1xuXG4vKipcbiAqIEdldCB0aGUgc2l6ZSBvZiB0aGUgcGFydGljdWxhciBmaWxlIGxvY2F0ZWQgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSByZW1vdGVQYXRoIC0gVGhlIHJlbW90ZSBwYXRoIHRvIHRoZSBmaWxlLlxuICogQHJldHVybiB7bnVtYmVyfSBGaWxlIHNpemUgaW4gYnl0ZXMuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlcmUgd2FzIGFuIGVycm9yIHdoaWxlIGdldHRpbmcgdGhlIHNpemUgb2YgdGhlIGdpdmVuIGZpbGUuXG4gKi9cbnN5c3RlbUNhbGxNZXRob2RzLmZpbGVTaXplID0gYXN5bmMgZnVuY3Rpb24gZmlsZVNpemUgKHJlbW90ZVBhdGgpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBmaWxlcyA9IGF3YWl0IHRoaXMubHMocmVtb3RlUGF0aCwgWyctbGEnXSk7XG4gICAgaWYgKGZpbGVzLmxlbmd0aCAhPT0gMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZW1vdGUgcGF0aCBpcyBub3QgYSBmaWxlYCk7XG4gICAgfVxuICAgIC8vIGh0dHBzOi8vcmVnZXgxMDEuY29tL3IvZk9zNFA0LzhcbiAgICBjb25zdCBtYXRjaCA9IC9bcnd4c1N0VFxcLStdezEwfVtcXHNcXGRdKlxcc1teXFxzXStcXHMrW15cXHNdK1xccysoXFxkKykvLmV4ZWMoZmlsZXNbMF0pO1xuICAgIGlmICghbWF0Y2ggfHwgXy5pc05hTihwYXJzZUludChtYXRjaFsxXSwgMTApKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gcGFyc2Ugc2l6ZSBmcm9tIGxpc3Qgb3V0cHV0OiAnJHtmaWxlc1swXX0nYCk7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZUludChtYXRjaFsxXSwgMTApO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBnZXQgZmlsZSBzaXplIGZvciAnJHtyZW1vdGVQYXRofSc6ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbi8qKlxuICogSW5zdGFsbHMgdGhlIGdpdmVuIGNlcnRpZmljYXRlIG9uIGEgcm9vdGVkIHJlYWwgZGV2aWNlIG9yXG4gKiBhbiBlbXVsYXRvci4gVGhlIGVtdWxhdG9yIG11c3QgYmUgZXhlY3V0ZWQgd2l0aCBgLXdyaXRhYmxlLXN5c3RlbWBcbiAqIGNvbW1hbmQgbGluZSBvcHRpb24gYW5kIGFkYiBkYWVtb24gc2hvdWxkIGJlIHJ1bm5pbmcgaW4gcm9vdFxuICogbW9kZSBmb3IgdGhpcyBtZXRob2QgdG8gd29yayBwcm9wZXJseS4gVGhlIG1ldGhvZCBhbHNvIHJlcXVpcmVzXG4gKiBvcGVuc3NsIHRvb2wgdG8gYmUgYXZhaWxhYmxlIG9uIHRoZSBkZXN0aW5hdGlvbiBzeXN0ZW0uXG4gKiBSZWFkIGh0dHBzOi8vZ2l0aHViLmNvbS9hcHBpdW0vYXBwaXVtL2lzc3Vlcy8xMDk2NFxuICogZm9yIG1vcmUgZGV0YWlscyBvbiB0aGlzIHRvcGljXG4gKlxuICogQHBhcmFtIHtCdWZmZXJ8c3RyaW5nfSBjZXJ0IC0gYmFzZTY0LWRlY29kZWQgY29udGVudCBvZiB0aGUgYWN0dWFsIGNlcnRpZmljYXRlXG4gKiByZXByZXNlbnRlZCBhcyBhIHN0cmluZyBvciBhIGJ1ZmZlclxuICogQHRocm93cyB7RXJyb3J9IElmIG9wZW5zc2wgdG9vbCBpcyBub3QgYXZhaWxhYmxlIG9uIHRoZSBkZXN0aW5hdGlvbiBzeXN0ZW1cbiAqIG9yIGlmIHRoZXJlIHdhcyBhbiBlcnJvciB3aGlsZSBpbnN0YWxsaW5nIHRoZSBjZXJ0aWZpY2F0ZVxuICovXG5zeXN0ZW1DYWxsTWV0aG9kcy5pbnN0YWxsTWl0bUNlcnRpZmljYXRlID0gYXN5bmMgZnVuY3Rpb24gaW5zdGFsbE1pdG1DZXJ0aWZpY2F0ZSAoY2VydCkge1xuICBjb25zdCBvcGVuU3NsID0gYXdhaXQgZ2V0T3BlblNzbEZvck9zKCk7XG5cbiAgaWYgKCFfLmlzQnVmZmVyKGNlcnQpKSB7XG4gICAgY2VydCA9IEJ1ZmZlci5mcm9tKGNlcnQsICdiYXNlNjQnKTtcbiAgfVxuXG4gIGNvbnN0IHRtcFJvb3QgPSBhd2FpdCB0ZW1wRGlyLm9wZW5EaXIoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCBzcmNDZXJ0ID0gcGF0aC5yZXNvbHZlKHRtcFJvb3QsICdzb3VyY2UuY2VyJyk7XG4gICAgYXdhaXQgZnMud3JpdGVGaWxlKHNyY0NlcnQsIGNlcnQpO1xuICAgIGxldCB7c3Rkb3V0fSA9IGF3YWl0IGV4ZWMob3BlblNzbCwgWyd4NTA5JywgJy1ub291dCcsICctaGFzaCcsICctaW4nLCBzcmNDZXJ0XSk7XG4gICAgY29uc3QgY2VydEhhc2ggPSBzdGRvdXQudHJpbSgpO1xuICAgIGxvZy5kZWJ1ZyhgR290IGNlcnRpZmljYXRlIGhhc2g6ICR7Y2VydEhhc2h9YCk7XG4gICAgbG9nLmRlYnVnKCdQcmVwYXJpbmcgY2VydGlmaWNhdGUgY29udGVudCcpO1xuICAgICh7c3Rkb3V0fSA9IGF3YWl0IGV4ZWMob3BlblNzbCwgWyd4NTA5JywgJy1pbicsIHNyY0NlcnRdLCB7aXNCdWZmZXI6IHRydWV9KSk7XG4gICAgbGV0IGRzdENlcnRDb250ZW50ID0gc3Rkb3V0O1xuICAgICh7c3Rkb3V0fSA9IGF3YWl0IGV4ZWMob3BlblNzbCwgWyd4NTA5JyxcbiAgICAgICctaW4nLCBzcmNDZXJ0LFxuICAgICAgJy10ZXh0JyxcbiAgICAgICctZmluZ2VycHJpbnQnLFxuICAgICAgJy1ub291dCddLCB7aXNCdWZmZXI6IHRydWV9KSk7XG4gICAgZHN0Q2VydENvbnRlbnQgPSBCdWZmZXIuY29uY2F0KFtkc3RDZXJ0Q29udGVudCwgc3Rkb3V0XSk7XG4gICAgY29uc3QgZHN0Q2VydCA9IHBhdGgucmVzb2x2ZSh0bXBSb290LCBgJHtjZXJ0SGFzaH0uMGApO1xuICAgIGF3YWl0IGZzLndyaXRlRmlsZShkc3RDZXJ0LCBkc3RDZXJ0Q29udGVudCk7XG4gICAgbG9nLmRlYnVnKCdSZW1vdW50aW5nIC9zeXN0ZW0gaW4gcncgbW9kZScpO1xuICAgIC8vIFNvbWV0aW1lcyBlbXVsYXRvciByZWJvb3QgaXMgc3RpbGwgbm90IGZ1bGx5IGZpbmlzaGVkIG9uIHRoaXMgc3RhZ2UsIHNvIHJldHJ5XG4gICAgYXdhaXQgcmV0cnlJbnRlcnZhbCg1LCAyMDAwLCBhc3luYyAoKSA9PiBhd2FpdCB0aGlzLmFkYkV4ZWMoWydyZW1vdW50J10pKTtcbiAgICBsb2cuZGVidWcoYFVwbG9hZGluZyB0aGUgZ2VuZXJhdGVkIGNlcnRpZmljYXRlIGZyb20gJyR7ZHN0Q2VydH0nIHRvICcke0NFUlRTX1JPT1R9J2ApO1xuICAgIGF3YWl0IHRoaXMucHVzaChkc3RDZXJ0LCBDRVJUU19ST09UKTtcbiAgICBsb2cuZGVidWcoJ1JlbW91bnRpbmcgL3N5c3RlbSB0byBjb25maXJtIGNoYW5nZXMnKTtcbiAgICBhd2FpdCB0aGlzLmFkYkV4ZWMoWydyZW1vdW50J10pO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBpbmplY3QgdGhlIGN1c3RvbSBjZXJ0aWZpY2F0ZS4gYCArXG4gICAgICAgICAgICAgICAgICAgIGBJcyB0aGUgY2VydGlmaWNhdGUgcHJvcGVybHkgZW5jb2RlZCBpbnRvIGJhc2U2NC1zdHJpbmc/IGAgK1xuICAgICAgICAgICAgICAgICAgICBgRG8geW91IGhhdmUgcm9vdCBwZXJtaXNzaW9ucyBvbiB0aGUgZGV2aWNlPyBgICtcbiAgICAgICAgICAgICAgICAgICAgYE9yaWdpbmFsIGVycm9yOiAke2Vyci5tZXNzYWdlfWApO1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IGZzLnJpbXJhZih0bXBSb290KTtcbiAgfVxufTtcblxuLyoqXG4gKiBWZXJpZmllcyBpZiB0aGUgZ2l2ZW4gcm9vdCBjZXJ0aWZpY2F0ZSBpcyBhbHJlYWR5IGluc3RhbGxlZCBvbiB0aGUgZGV2aWNlLlxuICpcbiAqIEBwYXJhbSB7QnVmZmVyfHN0cmluZ30gY2VydCAtIGJhc2U2NC1kZWNvZGVkIGNvbnRlbnQgb2YgdGhlIGFjdHVhbCBjZXJ0aWZpY2F0ZVxuICogcmVwcmVzZW50ZWQgYXMgYSBzdHJpbmcgb3IgYSBidWZmZXJcbiAqIEB0aHJvd3Mge0Vycm9yfSBJZiBvcGVuc3NsIHRvb2wgaXMgbm90IGF2YWlsYWJsZSBvbiB0aGUgZGVzdGluYXRpb24gc3lzdGVtXG4gKiBvciBpZiB0aGVyZSB3YXMgYW4gZXJyb3Igd2hpbGUgY2hlY2tpbmcgdGhlIGNlcnRpZmljYXRlXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gdHJ1ZSBpZiB0aGUgZ2l2ZW4gY2VydGlmaWNhdGUgaXMgYWxyZWFkeSBpbnN0YWxsZWRcbiAqL1xuc3lzdGVtQ2FsbE1ldGhvZHMuaXNNaXRtQ2VydGlmaWNhdGVJbnN0YWxsZWQgPSBhc3luYyBmdW5jdGlvbiBpc01pdG1DZXJ0aWZpY2F0ZUluc3RhbGxlZCAoY2VydCkge1xuICBjb25zdCBvcGVuU3NsID0gYXdhaXQgZ2V0T3BlblNzbEZvck9zKCk7XG5cbiAgaWYgKCFfLmlzQnVmZmVyKGNlcnQpKSB7XG4gICAgY2VydCA9IEJ1ZmZlci5mcm9tKGNlcnQsICdiYXNlNjQnKTtcbiAgfVxuXG4gIGNvbnN0IHRtcFJvb3QgPSBhd2FpdCB0ZW1wRGlyLm9wZW5EaXIoKTtcbiAgbGV0IGNlcnRIYXNoO1xuICB0cnkge1xuICAgIGNvbnN0IHRtcENlcnQgPSBwYXRoLnJlc29sdmUodG1wUm9vdCwgJ3NvdXJjZS5jZXInKTtcbiAgICBhd2FpdCBmcy53cml0ZUZpbGUodG1wQ2VydCwgY2VydCk7XG4gICAgY29uc3Qge3N0ZG91dH0gPSBhd2FpdCBleGVjKG9wZW5Tc2wsIFsneDUwOScsICctbm9vdXQnLCAnLWhhc2gnLCAnLWluJywgdG1wQ2VydF0pO1xuICAgIGNlcnRIYXNoID0gc3Rkb3V0LnRyaW0oKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmV0cmlldmUgdGhlIGNlcnRpZmljYXRlIGhhc2guIGAgK1xuICAgICAgICAgICAgICAgICAgICBgSXMgdGhlIGNlcnRpZmljYXRlIHByb3Blcmx5IGVuY29kZWQgaW50byBiYXNlNjQtc3RyaW5nPyBgICtcbiAgICAgICAgICAgICAgICAgICAgYE9yaWdpbmFsIGVycm9yOiAke2Vyci5tZXNzYWdlfWApO1xuICB9IGZpbmFsbHkge1xuICAgIGF3YWl0IGZzLnJpbXJhZih0bXBSb290KTtcbiAgfVxuICBjb25zdCBkc3RQYXRoID0gcGF0aC5wb3NpeC5yZXNvbHZlKENFUlRTX1JPT1QsIGAke2NlcnRIYXNofS4wYCk7XG4gIGxvZy5kZWJ1ZyhgQ2hlY2tpbmcgaWYgdGhlIGNlcnRpZmljYXRlIGlzIGFscmVhZHkgaW5zdGFsbGVkIGF0ICcke2RzdFBhdGh9J2ApO1xuICByZXR1cm4gYXdhaXQgdGhpcy5maWxlRXhpc3RzKGRzdFBhdGgpO1xufTtcblxuZXhwb3J0IGRlZmF1bHQgc3lzdGVtQ2FsbE1ldGhvZHM7XG5leHBvcnQgeyBERUZBVUxUX0FEQl9FWEVDX1RJTUVPVVQgfTtcbiJdLCJmaWxlIjoibGliL3Rvb2xzL3N5c3RlbS1jYWxscy5qcyIsInNvdXJjZVJvb3QiOiIuLi8uLi8uLiJ9
