import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './styles.module.css';

/**
 * Swizzles Docusaurus's Algolia SearchBar. The crawler index
 * (woss_github_io_jplv42car7_pages) stores generic crawler records
 * (title/url/content) without the DocSearch hierarchy schema, so the built-in
 * DocSearch UI renders nothing. This component reproduces the standard
 * DocSearch UX — navbar button (⌘K), centered modal, arrow-key navigation —
 * against the same index, rendering real links.
 *
 * Long-term: switch the crawler's extractor to "DocSearch - hierarchy" in the
 * Algolia dashboard and the native DocSearch UI replaces this entirely.
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
}

function prettyPath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\.html$/, '').replace(/^\/exiftool\//, '');
  } catch {
    return url;
  }
}

function snippet(hit: Hit): string {
  const text = hit.description && hit.description !== 'Documentation for @woss/exiftool'
    ? hit.description
    : hit.content;
  if (!text) return prettyPath(hit.url);
  return text.length > 110 ? `${text.slice(0, 110)}…` : text;
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
}

export default function SearchBar(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  const closeModal = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHits([]);
    setActive(0);
  }, []);

  // ⌘K / Ctrl+K toggles the modal; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        closeModal();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeModal]);

  // Focus the input when the modal opens.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
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
        if (seq !== seqRef.current) return;
        setHits(data.hits ?? []);
        setActive(0);
      } catch {
        if (seq === seqRef.current) setHits([]);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const navigate = useCallback((url: string) => {
    window.location.href = url;
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && hits[active]) {
      navigate(hits[active].url);
    }
  };

  // Keep the active item in view.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, hits]);

  return (
    <>
      <button type="button" className={styles.button} onClick={() => setOpen(true)} aria-label="Search">
        <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <span className={styles.buttonLabel}>Search</span>
        <kbd className={styles.kbd}>{isMac() ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      {open && (
        <div className={styles.overlay} onClick={closeModal}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.inputRow}>
              <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={inputRef}
                className={styles.input}
                type="search"
                placeholder="Search docs…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                aria-label="Search documentation"
              />
              <button type="button" className={styles.close} onClick={closeModal} aria-label="Close search">
                ESC
              </button>
            </div>

            <div className={styles.results} ref={listRef}>
              {query.trim().length < 2 ? (
                <div className={styles.hint}>Type at least 2 characters to search.</div>
              ) : loading ? (
                <div className={styles.hint}>Searching…</div>
              ) : hits.length === 0 ? (
                <div className={styles.hint}>No results for “{query.trim()}”.</div>
              ) : (
                hits.map((hit, i) => (
                  <a
                    key={hit.objectID}
                    href={hit.url}
                    data-active={i === active}
                    className={styles.item}
                    onMouseEnter={() => setActive(i)}
                    onClick={(e) => {
                      if (!e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        navigate(hit.url);
                      }
                    }}
                  >
                    <span className={styles.itemTitle}>{hit.title ?? prettyPath(hit.url)}</span>
                    <span className={styles.itemPath}>{snippet(hit)}</span>
                  </a>
                ))
              )}
            </div>

            <div className={styles.footer}>
              <span><kbd className={styles.kbdSmall}>↑↓</kbd> navigate</span>
              <span><kbd className={styles.kbdSmall}>↵</kbd> open</span>
              <span><kbd className={styles.kbdSmall}>esc</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
