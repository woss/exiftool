import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'exiftool-ts',
  tagline: 'TypeScript ExifTool wrapper with C2PA support',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://woss.github.io',
  baseUrl: '/exiftool-ts/',

  organizationName: 'woss',
  projectName: 'exiftool-ts',
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
          editUrl: 'https://github.com/woss/exiftool-ts/tree/main/docs/',
          routeBasePath: '/',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: 'all',
            copyright: `Copyright © ${new Date().getFullYear()} exiftool-ts.`,
          },
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/exiftool-ts-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'exiftool-ts',
      logo: {
        alt: 'exiftool-ts Logo',
        src: 'img/logo.svg',
      },
      items: [
        { type: 'docSidebar', sidebarId: 'tutorialSidebar', position: 'left', label: 'Guide' },
        { to: '/getting-started', label: 'Getting Started', position: 'left' },
        { to: '/c2pa/overview', label: 'C2PA', position: 'left' },
        { to: '/cli/usage', label: 'CLI', position: 'left' },
        { to: '/demo', label: 'Demo', position: 'left' },
        { to: '/api', label: 'API (Docusaurus)', position: 'left' },
        { href: '/exiftool-ts/typedoc/', label: 'API (TypeDoc)', position: 'left' },
        { href: 'https://github.com/woss/exiftool-ts', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting Started', to: '/getting-started' },
            { label: 'C2PA Guide', to: '/c2pa/overview' },
            { label: 'CLI Reference', to: '/cli/usage' },
          ],
        },
        {
          title: 'Community',
          items: [
            { label: 'GitHub', href: 'https://github.com/woss/exiftool-ts' },
            { label: 'Issues', href: 'https://github.com/woss/exiftool-ts/issues' },
            { label: 'Discussions', href: 'https://github.com/woss/exiftool-ts/discussions' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'npm', href: 'https://www.npmjs.com/package/exiftool-ts' },
            { label: 'GitHub', href: 'https://github.com/woss/exiftool-ts' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} exiftool-ts. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['typescript', 'json', 'bash', 'yaml'],
    },
    algolia: {
      appId: 'BH4D9OD16A',
      apiKey: 'f9e9c9a5f5c7d5e5f5f5f5f5f5f5f5f5f5f5f',
      indexName: 'exiftool-ts',
    },
  } satisfies Preset.ThemeConfig,
};

export default config;