import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/getting-started">
            Get Started
          </Link>
          <Link
            className="button button--outline button--lg"
            to="/cli/usage"
            style={{marginLeft: '1rem'}}>
            CLI Reference
          </Link>
        </div>
      </div>
    </header>
  );
}

function Features() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.featureGrid}>
          <div className={clsx('feature-card', styles.featureCard)}>
            <h3>📸 ExifTool Parity</h3>
            <p>Value-level parity suite against ExifTool 13.55+. Reads EXIF, XMP, IPTC, GPS, ICC, and more — every divergence tracked in a public register.</p>
          </div>
          <div className={clsx('feature-card', styles.featureCard)}>
            <h3>🎞 RAW Container Reading</h3>
            <p>TIFF, DNG, CR2, NEF, ARW, ORF, RW2, PEF, ERF, DCR, SRW — standard IFD0/Exif/GPS/SubIFD/XMP tags from RAW files, read-only.</p>
          </div>
          <div className={clsx('feature-card', styles.featureCard)}>
            <h3>🧵 Zero-Copy Buffers</h3>
            <p>In-memory reads return views into the source buffer, not copies. One process, no subprocess per file.</p>
          </div>
          <div className={clsx('feature-card', styles.featureCard)}>
            <h3>📦 Multi-Format Support</h3>
            <p>JPEG, PNG, WebP, AVIF/HEIF, and TIFF-family RAW images. One plugin-based API, load only the formats you bundle.</p>
          </div>
          <div className={clsx('feature-card', styles.featureCard)}>
            <h3>🛠 CLI Compatible</h3>
            <p>Drop-in ExifTool CLI replacement. Supports -j, -csv, -X, -t, -if filters, -stay_open, and more.</p>
          </div>
          <div className={clsx('feature-card', styles.featureCard)}>
            <h3>📝 TypeScript Native</h3>
            <p>Full type definitions, strict typing, and IntelliSense support. Built for modern TypeScript projects.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function QuickStart() {
  return (
    <section className={styles.quickStart}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          Quick Start
        </Heading>
        <div className={styles.codeTabs}>
          <div className={styles.tab}>
            <h4>TypeScript</h4>
            <pre><code>{`import { ExifTool } from 'exiftool-ts';

const exiftool = new ExifTool();
const result = await exiftool.read('photo.jpg');

console.log(result.tags.Make);        // "Canon"
console.log(result.tags.Model);       // "EOS R5"
console.log(result.tags.ImageSize);   // "9600x6376"
`}</code></pre>
          </div>
          <div className={styles.tab}>
            <h4>CLI</h4>
            <pre><code>{`# Basic usage
npx exiftool-ts photo.jpg

# JSON output (ExifTool compatible)
npx exiftool-ts -j photo.jpg

# RAW metadata
npx exiftool-ts -j photo.dng

# All tags with groups
npx exiftool-ts -G1 -j photo.jpg
`}</code></pre>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.tagline}
      description="ExifTool rewrite in TypeScript — read and write image metadata">
      <HomepageHeader />
      <main>
        <Features />
        <QuickStart />
      </main>
    </Layout>
  );
}