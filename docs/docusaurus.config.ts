import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'exiftool',
  tagline: 'ExifTool rewrite in TypeScript — read and write image metadata',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://woss.github.io',
  baseUrl: '/exiftool/',

  organizationName: 'woss',
  projectName: 'exiftool',
  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/woss/exiftool/tree/main/docs/',
          routeBasePath: '/',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: 'all',
            copyright: `Copyright © ${new Date().getFullYear()} exiftool.`,
          },
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/exiftool-social-card.jpg',
    metadata: [{ name: 'algolia-site-verification', content: 'FBAECA7265DDF53B' }],
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'exiftool',
      logo: {
        alt: 'exiftool Logo',
        src: 'img/logo.svg',
      },
      items: [
        // Algolia Experiences search renders itself into #autocomplete; the
        // bridge script makes results clickable (see static/experiences-bridge.js).
        { type: 'html', value: '<div id="autocomplete"></div>', position: 'right' },
        { type: 'docSidebar', sidebarId: 'tutorialSidebar', position: 'left', label: 'Guide' },
        { to: '/getting-started', label: 'Getting Started', position: 'left' },
        { to: '/cli/usage', label: 'CLI', position: 'left' },
        { to: '/demo', label: 'Demo', position: 'left' },
        { to: '/api', label: 'API (Docusaurus)', position: 'left' },
        { href: '/exiftool/typedoc/', label: 'API (TypeDoc)', position: 'left' },
        { href: 'https://github.com/woss/exiftool', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting Started', to: '/getting-started' },
            { label: 'CLI Reference', to: '/cli/usage' },
          ],
        },
        {
          title: 'Community',
          items: [
            { label: 'GitHub', href: 'https://github.com/woss/exiftool' },
            { label: 'Issues', href: 'https://github.com/woss/exiftool/issues' },
            { label: 'Discussions', href: 'https://github.com/woss/exiftool/discussions' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'npm', href: 'https://www.npmjs.com/package/@woss/exiftool' },
            { label: 'GitHub', href: 'https://github.com/woss/exiftool' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} exiftool. Built with Docusaurus. Made with Human and AI effort — <a href="https://woss.io" target="_blank" rel="noopener noreferrer">woss.io</a>.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['typescript', 'json', 'bash', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
  scripts: [
    // Algolia Experiences search (app JPLV42CAR7). The crawler index holds
    // generic records, so the built-in DocSearch UI can't be used; the widget
    // renders into the #autocomplete navbar item. The second script bridges
    // result clicks to record URLs until the experience's link mapping is
    // configured in the Algolia dashboard.
    'https://cdn.jsdelivr.net/npm/@algolia/experiences/dist/experiences.js?appId=JPLV42CAR7&apiKey=a4d8070414e4d9729c3365cd47cbffc6&experienceId=JPLV42CAR7&env=prod',
    '/exiftool/experiences-bridge.js',
  ],
};

export default config;