// Settings for `npx web-ext lint` and `npx web-ext build`: package only the
// files the extension needs.
export default {
  ignoreFiles: [
    'assets/*.png',
    '*.png',
    'README.md',
    'LICENSE',
    'scripts',
    'web-ext-config.mjs'
  ]
};
