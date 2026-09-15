import React, { useEffect, useRef, useState } from 'react';
import styles from './styles.module.css';

/**
 * Swizzles Docusaurus's Algolia SearchBar. The crawler index
 * (woss_github_io_jplv42car7_pages) stores generic crawler records
 * (title/url/content) without the DocSearch hierarchy schema, so the built-in
 * DocSearch UI renders nothing. This component queries the same index directly
 * and renders real links.
 */

const APP_ID = 'JPLV42CAR7';
const SEARCH_KEY = 'a4d8070414e4d9729c3365cd47cbffc6';
const INDEX = 'woss_github_io_jplv42car7_pages';

interface Hit {
  objectID: string;
  url: string;
  title?: string;
  description?: string;
  content?: string;
  path?: string;
}

function truncate(text: string | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function prettyPath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\.html$/, '');
  } catch {
    return url;
  }
}

export default function SearchBar(): React.ReactElement {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`, {
          method: 'POST',
          headers: {
            'X-Algolia-Application-Id': APP_ID,
            'X-Algolia-API-Key': SEARCH_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: q, hitsPerPage: 8 }),
        });
        const data = await res.json();
        if (seq !== seqRef.current) return; // stale response
        setHits(data.hits ?? []);
        setOpen(true);
      } catch {
        if (seq === seqRef.current) setOpen(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const navigate = (url: string) => {
    setOpen(false);
    setQuery('');
    window.location.href = url;
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <input
        className={styles.input}
        type="search"
        placeholder="Search docs…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        aria-label="Search documentation"
      />
      {open && (
        <div className={styles.panel}>
          {hits.length === 0 ? (
            <div className={styles.empty}>No results for “{query.trim()}”.</div>
          ) : (
            hits.map((hit) => (
              <a
                key={hit.objectID}
                className={styles.item}
                href={hit.url}
                onClick={(e) => {
                  if (!e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    navigate(hit.url);
                  }
                }}
              >
                <span className={styles.itemTitle}>{truncate(hit.title ?? prettyPath(hit.url), 70)}</span>
                <span className={styles.itemPath}>{truncate(hit.description || hit.content || prettyPath(hit.url), 90)}</span>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
