import { useEffect, useId, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Film, Search as SearchIcon, Tv, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useDebounced } from '../lib/hooks';
import { groupLabel, quickItems, totalResults, type QuickItem } from '../lib/search';
import type { SearchResults } from '../lib/types';
import { Artwork } from './Artwork';
import { Spinner } from './States';
import { useT } from '../i18n';

/**
 * Search from anywhere (Ctrl/⌘+K or "/"): a few results of each kind while typing, arrow keys and
 * Enter to open one, and a link to all results. One request per pause in typing.
 */
export function QuickSearch({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { t } = useT();
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const query = useDebounced(text.trim(), 200);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useQuery({
    queryKey: ['search', query],
    enabled: query.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: () => api.get<SearchResults>(`/api/search${qs({ q: query })}`),
  });
  const results = query ? q.data : undefined;
  const items = quickItems(results);
  const total = totalResults(results);
  // The last row opens the full results page.
  const allHref = `/search${qs({ q: query })}`;
  const rows = items.length + (query ? 1 : 0);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const open = (href: string) => {
    onClose();
    navigate(href);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (text) setText('');
      else onClose();
    } else if (e.key === 'ArrowDown' && rows) {
      e.preventDefault();
      setActive((a) => (a + 1) % rows);
    } else if (e.key === 'ArrowUp' && rows) {
      e.preventDefault();
      setActive((a) => (a - 1 + rows) % rows);
    } else if (e.key === 'Enter' && query) {
      e.preventDefault();
      open(active < items.length ? items[active].href : allHref);
    }
  };
  const optionId = (i: number) => `${listId}-${i}`;

  let lastGroup: string | null = null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center sm:px-4 sm:pt-[12vh]" role="dialog" aria-modal="true" aria-label={t('nav.searchVelyx')}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-surface shadow-2xl sm:h-auto sm:max-h-[70vh] sm:max-w-xl sm:rounded-2xl sm:border sm:border-line">
        <div className="flex items-center gap-3 border-b border-line/70 px-4">
          <SearchIcon className="size-5 shrink-0 text-faint" />
          <input
            ref={inputRef}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('quickSearch.placeholder')}
            role="combobox"
            aria-expanded={rows > 0}
            aria-controls={listId}
            aria-activedescendant={rows ? optionId(active) : undefined}
            aria-autocomplete="list"
            aria-label={t('nav.searchVelyx')}
            className="h-14 flex-1 bg-transparent text-lg outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
          />
          {q.isFetching && <Spinner className="size-4" />}
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink" aria-label={t('quickSearch.close')}>
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto py-2">
          {!query ? (
            <p className="px-4 py-6 text-sm text-muted">{t('quickSearch.hint')}</p>
          ) : results && total === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">{t('quickSearch.nothingFound', { query })}</p>
          ) : (
            <ul id={listId} role="listbox" aria-label={t('quickSearch.results')}>
              {items.map((item: QuickItem, i) => {
                const header = item.group !== lastGroup ? groupLabel(item.group) : null;
                lastGroup = item.group;
                return (
                  <li key={item.key} role="presentation">
                    {header && <p className="px-4 pt-3 pb-1 text-xs font-medium tracking-wide text-faint uppercase" aria-hidden>{header}</p>}
                    <div
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => open(item.href)}
                      className={`mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 ${i === active ? 'bg-raised' : ''}`}
                    >
                      <div className={`shrink-0 overflow-hidden rounded ${item.wide ? 'w-16' : 'w-9'}`} aria-hidden>
                        {item.image ? (
                          <Artwork path={item.image} size="w185" aspect={item.wide ? 'wide' : undefined} title={item.title} />
                        ) : (
                          <div className={`grid place-items-center bg-raised text-faint ${item.wide ? 'aspect-video' : 'aspect-[2/3]'}`}>
                            {item.group === 'movies' ? <Film className="size-4" /> : <Tv className="size-4" />}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.title}</p>
                        {item.meta && <p className="truncate text-xs text-muted">{item.meta}</p>}
                      </div>
                    </div>
                  </li>
                );
              })}
              {query && (
                <li role="presentation">
                  <div
                    id={optionId(items.length)}
                    role="option"
                    aria-selected={active === items.length}
                    onMouseEnter={() => setActive(items.length)}
                    onClick={() => open(allHref)}
                    className={`mx-2 mt-1 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm ${active === items.length ? 'bg-raised' : 'text-muted'}`}
                  >
                    {total ? t('quickSearch.allResultsCount', { query, count: total }) : t('quickSearch.allResults', { query })}
                    <ArrowRight className="size-4" />
                  </div>
                </li>
              )}
            </ul>
          )}
        </div>
        <p className="hidden border-t border-line/70 px-4 py-2 text-xs text-faint sm:block">{t('quickSearch.keys')}</p>
      </div>
    </div>
  );
}
