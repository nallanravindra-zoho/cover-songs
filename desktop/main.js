// Cover Songs as a Mac app (a sample to try the idea): one window with the settings page, real Mac menus, and the page's
// server (settings.py) started and stopped by the app. The page itself is unchanged; this only wraps it.
//
//   cd desktop && npm install && npm start
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

// the project folder: next to this file when run with npm start; written into the packaged app by make_app.sh
const ROOT = require('fs').existsSync(path.join(__dirname, 'root.txt')) ? require('fs').readFileSync(path.join(__dirname, 'root.txt'), 'utf8').trim() : path.resolve(__dirname, '..');
const URL = 'http://127.0.0.1:8766/';
let server = null, win = null;

app.setName('Cover Songs');

function alive() {
  return new Promise(res => { const r = http.get(URL, x => { x.resume(); res(true); }); r.on('error', () => res(false)); r.setTimeout(800, () => { r.destroy(); res(false); }); });
}
async function startServer() {          // use the page's server if it is already running, otherwise start it (and stop it on quit)
  if (await alive()) return;
  server = spawn(path.join(ROOT, '.venv/bin/python'), ['settings.py', '--no-open'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 40 && !(await alive()); i++) await new Promise(r => setTimeout(r, 250));
}
const run = js => win && win.webContents.executeJavaScript(js).catch(() => {});

function menu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Song', submenu: [
      { label: 'New Song…', accelerator: 'Cmd+N', click: () => run('newSong()') },
      { label: 'Save', accelerator: 'Cmd+S', click: () => run('save()') },
      { type: 'separator' },
      { label: 'Show Song Folder in Finder', click: () => run('S && S.name').then(n => n && shell.openPath(path.join(ROOT, 'songs', n))) } ] },
    { label: 'Edit', submenu: [            // Undo/Redo: the editor's (or a text box's own while typing in it)
      { label: 'Undo', accelerator: 'Cmd+Z', click: () => run('edUndoKey(false)') },
      { label: 'Redo', accelerator: 'Shift+Cmd+Z', click: () => run('edUndoKey(true)') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' } ] },
    { label: 'Video', submenu: [
      { label: 'Play / Pause', accelerator: 'Cmd+P', click: () => run('edPlay()') },
      { label: 'Back 5 Seconds', accelerator: 'Cmd+Left', click: () => run('edSeek(ED.vid.currentTime-5)') },
      { label: 'Forward 5 Seconds', accelerator: 'Cmd+Right', click: () => run('edSeek(ED.vid.currentTime+5)') },
      { type: 'separator' },
      { label: 'Split Her Video Here', accelerator: 'Cmd+B', click: () => run('edSplit()') },
      { label: 'Add a Lyric Screen Here', accelerator: 'Cmd+L', click: () => run('edAddScreen()') },
      { type: 'separator' },
      { label: 'Preview Full Screen', accelerator: 'Cmd+Shift+F', click: () => run('edMax()') } ] },
    { label: 'Make', submenu: [
      { label: 'Quick Preview of the Switched-on Videos', click: () => run("startRun('preview',rangeFrom(),rangeTo(),enabledOutputs())") },
      { label: 'Make Final Videos', accelerator: 'Cmd+Shift+M', click: async () => {
        const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Make them', 'Cancel'], message: 'Make the final videos?', detail: 'This takes a few minutes. The progress shows in step 8.' });
        if (r.response === 0) run("startRun('final',null,null,enabledOutputs())"); } },
      { label: 'Open the Finished Videos Folder', click: () => run('S && S.name').then(n => n && shell.openPath(path.join(ROOT, 'songs', n, 'out'))) } ] },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
}

async function createWindow() {
  await startServer();
  win = new BrowserWindow({
    width: 1500, height: 960, minWidth: 1000, minHeight: 700, show: false,
    title: 'Cover Songs', titleBarStyle: 'hiddenInset', backgroundColor: '#150d22',
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(URL);
  if (process.env.CS_SNAPSHOT) {          // test: a picture of the window, without showing it, then quit
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      require('fs').writeFileSync(process.env.CS_SNAPSHOT, (await win.webContents.capturePage()).toPNG()); app.quit(); }, 6000));
  } else win.once('ready-to-show', () => win.show());
  // room for the window buttons in the page's header, and the header drags the window like a title bar
  win.webContents.on('did-finish-load', () => win.webContents.insertCSS(
    'header{-webkit-app-region:drag;padding-top:30px!important} header button,header select,header a{-webkit-app-region:no-drag}'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => { if (app.dock) app.dock.setIcon(path.join(__dirname, 'icon.png')); menu(); createWindow(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (server) server.kill(); });
