// Only preload in Career Queue's non-interactive OpenClaw processes.
// Hiding the parent does not hide windows created by its subprocesses.
if (process.platform === 'win32') {
  const childProcess = require('node:child_process');
  const { basename } = require('node:path');
  const spawn = childProcess.spawn;
  childProcess.spawn = function (file, args, options) {
    const argv = Array.isArray(args) ? args : [];
    const settings = Array.isArray(args) ? options : args;
    if (settings?.windowsHide !== true) {
      // Do not log arguments, environment variables or command output.
      const script = argv.find(arg => typeof arg === 'string' && /\.(?:mjs|cjs|js)$/.test(arg));
      console.error(`[Career Queue ${new Date().toISOString()}] Hidden background child: ${basename(file)}${script ? ` (${basename(script)})` : ''}`);
    }
    return spawn.call(this, file, argv, { ...settings, windowsHide: true });
  };
  require('node:module').syncBuiltinESMExports();
}
