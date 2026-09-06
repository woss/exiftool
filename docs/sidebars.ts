import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'getting-started',
    'installation',
    {
      type: 'category',
      label: 'Core Concepts',
      items: [
        'core/parsing',
        'core/writing',
        'core/metadata-model',
      ],
    },
    {
      type: 'category',
      label: 'C2PA Support',
      items: [
        'c2pa/overview',
        'c2pa/jumbf-structure',
        'c2pa/plan',
      ],
    },
    {
      type: 'category',
      label: 'CLI Reference',
      items: [
        'cli/usage',
      ],
    },
    {
      type: 'link',
      label: 'Live Demo',
      href: '/demo',
    },
  ],
};

export default sidebars;