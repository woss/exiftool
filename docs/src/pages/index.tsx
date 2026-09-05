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
            <h3>📸 Full ExifTool Parity</h3>
            <p>99.93% tag parity with ExifTool 13.55+. Reads EXIF, XMP, IPTC, GPS, ICC, MakerNotes, and more.</p>
          </div>
          <div className={clsx('feature-card', styles.featureCard)}>
            <h3>🔐 C2PA Content Credentials</h3>
            <p>Complete JUMBF/CBOR parsing for C2PA manifests, actions, assertions, and signatures. Byte-exact with ExifTool.</p>
          </div>
          <div className={clsx('feature-card', styles.featureCard)}>
            <h3>⚡ Streaming & Zero-Copy</h3>
            <p>Parses files incrementally without loading entire files into memory. Handles multi-GB files efficiently.</p>
          </div>
          <div className={clsx('feature-card', styles.featureCard)}>
            <h3>📦 Multi-Format Support</h3>
            <p>JPEG, PNG, TIFF, HEIF, WebP, QuickTime, PDF, AVIF, JPEG XL. One API for all formats.</p>
          </div>
          <div className={clsx('feature-card', styles.featureCard)}>
            <h3>🛠 CLI Compatible</h3>
            <p>Drop-in ExifTool CLI replacement. Supports -j, -csv, -X, -t, -C2PA, -if filters, and more.</p>
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
console.log(result.tags.Claim_generator); // C2PA
`}</code></pre>
          </div>
          <div className={styles.tab}>
            <h4>CLI</h4>
            <pre><code>{`# Basic usage
npx exiftool-ts photo.jpg

# JSON output (ExifTool compatible)
npx exiftool-ts -j photo.jpg

# C2PA tags
npx exiftool-ts -C2PA photo.jpg

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
      title={`Hello from ${siteConfig.title}`}
      description="TypeScript ExifTool wrapper with full C2PA support">
      <HomepageHeader />
      <main>
        <Features />
        <QuickStart />
      </main>
    </Layout>
  );
}