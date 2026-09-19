const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

let mainWindow = null;
let agentProcess = null;

if (process.platform === 'win32') {
  app.setAppUserModelId('com.flint.app');
}

const APP_DIR = __dirname;
const DIST_FILE = fs.existsSync(path.join(APP_DIR, 'dist', 'index.html'))
  ? path.join(APP_DIR, 'dist', 'index.html')
  : path.join(APP_DIR, '..', 'dist', 'index.html');

function getAppIcon() {
  const isWindows = process.platform === 'win32';
  const candidates = isWindows ? [
    path.join(APP_DIR, 'icon.ico'),
    path.join(APP_DIR, 'flint-logo.ico'),
    path.join(APP_DIR, 'public', 'flint-logo.ico'),
    path.join(APP_DIR, '..', 'public', 'flint-logo.ico'),
    path.join(APP_DIR, 'dist', 'flint-logo.png'),
    path.join(APP_DIR, 'icon.png'),
    path.join(APP_DIR, 'flint-logo.png'),
    path.join(APP_DIR, '..', 'dist', 'flint-logo.png'),
    path.join(APP_DIR, '..', 'public', 'flint-logo.png'),
  ] : [
    path.join(APP_DIR, 'icon.png'),
    path.join(APP_DIR, 'flint-logo.png'),
    path.join(APP_DIR, 'dist', 'flint-logo.png'),
    path.join(APP_DIR, '..', 'dist', 'flint-logo.png'),
    path.join(APP_DIR, 'public', 'flint-logo.png'),
    path.join(APP_DIR, '..', 'public', 'flint-logo.png'),
    path.join(APP_DIR, 'icon.ico'),
    path.join(APP_DIR, '..', 'public', 'flint-logo.ico'),
  ];
  return candidates.find(p => fs.existsSync(p));
}

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
}

function startAgent() {
  const agentDir = path.join(APP_DIR, 'agent');
  const agentScript = path.join(agentDir, 'agent.py');
  const bundledAgent = path.join(APP_DIR, 'bin', process.platform === 'win32' ? 'agent.exe' : 'agent');

  // Check for venv python first (created by improved installer)
  const venvPython = process.platform === 'win32' 
    ? path.join(APP_DIR, '..', 'venv', 'Scripts', 'python.exe')
    : path.join(APP_DIR, '..', 'venv', 'bin', 'python3');

  if (fs.existsSync(bundledAgent)) {
    console.log('[Flint] Starting bundled AI agent...');
    agentProcess = spawn(bundledAgent, [], {
      cwd: path.dirname(bundledAgent),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });
  } else if (fs.existsSync(agentScript)) {
    console.log('[Flint] Starting Python AI agent...');
    
    let pythonCmd = null;
    let pythonArgs = [agentScript];

    if (fs.existsSync(venvPython)) {
      pythonCmd = venvPython;
      console.log('[Flint] Using venv Python:', venvPython);
    } else {
      const pythonCandidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
      pythonCmd = pythonCandidates.find(commandExists);
      if (pythonCmd === 'py') {
        pythonArgs = ['-3', agentScript];
      }
    }

    if (!pythonCmd) {
      console.log('[Flint] Python was not found. Note features remain available.');
      return;
    }

    agentProcess = spawn(pythonCmd, pythonArgs, {
      cwd: agentDir,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });
  } else {
    console.log('[Flint] No AI agent found. Note features remain available.');
    return;
  }

  agentProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log('[Flint Agent]', msg);
  });

  agentProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('DeprecationWarning') && !msg.includes('WARNING')) {
      console.log('[Flint Agent]', msg);
    }
  });

  agentProcess.on('error', (err) => {
    console.log('[Flint] Agent failed to start:', err.message);
    console.log('[Flint] Install Python packages with: pip install -r agent/requirements.txt');
  });

  agentProcess.on('exit', (code) => {
    console.log('[Flint] Agent stopped (code', code, ')');
    agentProcess = null;
  });
}

function stopAgent() {
  if (agentProcess) {
    console.log('[Flint] Stopping agent...');
    agentProcess.kill('SIGTERM');
    agentProcess = null;
  }
}

function createWindow() {
  if (!fs.existsSync(DIST_FILE)) {
    console.error('[Flint] ERROR: dist/index.html not found at ' + DIST_FILE);
    console.error('[Flint] Reinstall Flint from the official installer.');
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Flint',
    backgroundColor: '#0a0a0a',
    icon: getAppIcon(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.loadFile(DIST_FILE).then(() => {
    console.log('[Flint] Loaded successfully');
  }).catch(err => {
    console.error('[Flint] Failed to load:', err.message);
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      console.log('[Flint] Window displayed');
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startAgent();
    createWindow();
    console.log('[Flint] App ready in desktop mode');
  });

  app.on('window-all-closed', () => {
    stopAgent();
    app.quit();
  });

  app.on('before-quit', () => {
    stopAgent();
  });

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
  });
}
