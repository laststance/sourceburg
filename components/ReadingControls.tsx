'use client'

import { useLayoutEffect, useSyncExternalStore } from 'react'

import {
  READING_FONTS,
  READING_FONT_ATTR,
  READING_FONT_DEFAULT,
  READING_FONT_KEY,
  READING_SIZES,
  READING_SIZE_ATTR,
  READING_SIZE_DEFAULT,
  READING_SIZE_KEY,
} from '../lib/constants'

import type { ReadingFont, ReadingSize } from '../lib/constants'

/*
 * The reader's two knobs: typeface and text size.
 *
 * This is the FIRST client JavaScript on the reading path. Decision 11A drove client JS
 * for content to zero by tokenising code at build time, and that still holds — nothing
 * here renders a word of the article. All this ships is a preference: two attributes on
 * `<html>`, which `app/globals.css` turns into a family and a scale.
 *
 * Native `<details>` and native radios, so there is no focus management, no ARIA to get
 * wrong, and no open/close state in React. The choice a reader makes is theirs, not the
 * desk's: DESIGN.md still specifies Source Serif 4 at 1rem, and that is what everyone
 * gets until they say otherwise.
 *
 * localStorage is read through {@link useSyncExternalStore} rather than an effect. The
 * server has no localStorage and must render the default; a lazy `useState` initialiser
 * would render the stored value on the client and disagree with the server's HTML, and
 * a `useEffect` that corrects state after mount is a cascading render the linter is
 * right to refuse. `getServerSnapshot` says "the default" and `getSnapshot` says "what
 * this reader chose", which is exactly the split the hook exists for.
 */

/**
 * Notified after a choice changes. localStorage fires no event in the tab that wrote it,
 * so this tab's own writes go through {@link remember}; another tab's arrive as `storage`
 * and go through {@link adoptAnotherTabsChoice}.
 */
const listeners = new Set<() => void>()

/*
 * The live choices, seeded from localStorage on first read. Held in memory rather than
 * re-read per snapshot for two reasons: `useSyncExternalStore` compares snapshots by
 * identity and would loop on a fresh read, and a reader whose storage is unwritable
 * (private mode, quota) still gets the choice they just made for this page.
 */
let chosenFont: ReadingFont | null = null
let chosenSize: ReadingSize | null = null

/**
 * The stored choice if it is still one of the offered options, else the default.
 * Validating against the option list rather than casting is what keeps a stale or
 * hand-edited localStorage value from becoming a state React believes in.
 * @param storageKey - the localStorage key to read
 * @param options - the offered options, in menu order
 * @param fallback - what an absent, unreadable or unrecognised value means
 * @returns one of `options[].value`, never anything else
 * @example storedChoice(READING_FONT_KEY, READING_FONTS, 'serif') // => 'sans'
 */
function storedChoice<Value extends string>(
  storageKey: string,
  options: readonly { value: Value }[],
  fallback: Value,
): Value {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(storageKey)
  } catch {
    return fallback
  }
  return options.find((option) => option.value === stored)?.value ?? fallback
}

/**
 * Adopts a choice made in ANOTHER tab. `storage` fires only in the tabs that did not write,
 * which is exactly the case the in-memory cache below would otherwise strand: without this,
 * a reader with two articles open changes the typeface in one and the other keeps the old
 * one, and its radios keep the old dot, until a hard reload.
 * @param event - the browser's `storage` event; `key` is null when storage was cleared
 * @returns nothing; it drops the caches so the next snapshot re-reads, then re-renders
 * @example // tab A: chooseFont('sans')  ->  tab B re-renders in sans
 */
function adoptAnotherTabsChoice(event: StorageEvent): void {
  // Some other key on this origin, so nothing here changed.
  if (event.key !== null && event.key !== READING_FONT_KEY && event.key !== READING_SIZE_KEY) return
  chosenFont = null
  chosenSize = null
  // Re-seeds both caches from storage, then puts them on `<html>`: the snapshot readers are
  // the single source, and no effect is left watching the rendered value to do it instead.
  applyChoice(READING_FONT_ATTR, fontSnapshot())
  applyChoice(READING_SIZE_ATTR, sizeSnapshot())
  for (const listener of listeners) listener()
}

/** Registers a re-render callback. Returned to React, which calls it to unsubscribe. */
function subscribe(onStoreChange: () => void): () => void {
  // The first subscriber opens the cross-tab feed and the last one closes it. Registering
  // the same function twice is a no-op in the browser, but removing it once would cut off
  // the sibling subscriber still mounted, so the count is what decides rather than the call.
  if (listeners.size === 0) window.addEventListener('storage', adoptAnotherTabsChoice)
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
    if (listeners.size === 0) window.removeEventListener('storage', adoptAnotherTabsChoice)
  }
}

function fontSnapshot(): ReadingFont {
  chosenFont ??= storedChoice(READING_FONT_KEY, READING_FONTS, READING_FONT_DEFAULT)
  return chosenFont
}

function sizeSnapshot(): ReadingSize {
  chosenSize ??= storedChoice(READING_SIZE_KEY, READING_SIZES, READING_SIZE_DEFAULT)
  return chosenSize
}

/**
 * Puts a choice on `<html>`, which is the only place `app/globals.css` reads it from.
 * Every path that changes a choice calls this: this tab's own click, another tab's
 * `storage` event, and the mount repair. Deliberately NOT an effect keyed on the rendered
 * value — such an effect fires first with the SERVER snapshot, so on a hard load it wrote
 * the default over what the pre-paint script had set and restored it only a render later.
 * @param attribute - {@link READING_FONT_ATTR} or {@link READING_SIZE_ATTR}
 * @param value - the chosen option's `value`
 * @returns nothing; the CSS variable swap is the whole visible effect
 * @example applyChoice(READING_FONT_ATTR, 'sans')
 */
function applyChoice(attribute: string, value: string): void {
  document.documentElement.setAttribute(attribute, value)
}

/**
 * Writes a choice to storage and wakes every subscriber, after the caller has already
 * put it in memory — so an unwritable localStorage costs the reader persistence, never
 * the change they just asked for.
 * @param storageKey - the localStorage key this choice owns
 * @param value - the chosen option's `value`
 * @returns nothing; the re-render it triggers is what moves the page
 * @example remember(READING_FONT_KEY, 'sans')
 */
function remember(storageKey: string, value: string): void {
  try {
    localStorage.setItem(storageKey, value)
  } catch {
    // Private mode, or quota. The choice applies to this page and simply will not
    // survive a reload, which beats throwing inside an event handler.
  }
  for (const listener of listeners) listener()
}

/** Three lines each, and no cast: the alternative routed both through one key-sniffing branch. */
function chooseFont(value: ReadingFont): void {
  chosenFont = value
  applyChoice(READING_FONT_ATTR, value)
  remember(READING_FONT_KEY, value)
}

function chooseSize(value: ReadingSize): void {
  chosenSize = value
  applyChoice(READING_SIZE_ATTR, value)
  remember(READING_SIZE_KEY, value)
}

/** One labelled radio group. Two of these is the whole menu, so it stays local to this file. */
function ReadingRadioGroup<Value extends string>(props: {
  legend: string
  name: string
  options: readonly { value: Value; label: string }[]
  chosen: Value
  onChoose: (value: Value) => void
}) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="font-mono text-[0.65rem] tracking-wide uppercase">{props.legend}</legend>
      <div className="mt-1 flex flex-col">
        {props.options.map((option) => (
          // The label wraps the input, so the whole row is the target and no `for`/`id`
          // pair can drift apart. `min-h-11` is what makes the row 44px: `py-1.5` around a
          // 20px line box measured 32px, which clears WCAG 2.5.8 but misses the 44px this
          // site gives its own cite markers (DESIGN.md § Touch targets).
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-center gap-2 py-1.5 text-sm"
          >
            <input
              type="radio"
              name={props.name}
              value={option.value}
              checked={props.chosen === option.value}
              onChange={() => props.onChoose(option.value)}
              className="accent-ink"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * The reading menu in the masthead: pick a typeface, pick a size, both remembered.
 * @returns a `<details>` disclosure whose panel floats, so opening it never pushes the page down
 * @example <ReadingControls />
 */
export function ReadingControls() {
  const font = useSyncExternalStore(subscribe, fontSnapshot, () => READING_FONT_DEFAULT)
  const size = useSyncExternalStore(subscribe, sizeSnapshot, () => READING_SIZE_DEFAULT)

  // Repairs `<html>` once, after React's dev-only Strict Mode remount resets it to the
  // attributes it manages from JSX and drops what the pre-paint script wrote. It reads
  // STORAGE, never `font`/`size` above, and runs once, never on every change: an effect
  // keyed on the rendered value fired first with the server snapshot, so on a hard load it
  // reverted a returning reader's choice and restored it a render later. That was measured
  // on 24 of 24 loads. It never painted in between, because the revert and the restore are
  // one main-thread task, but it is a flash waiting for React to yield once.
  //
  // Before paint rather than after, per Next's own guide at
  // `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`
  // § Re-applying attributes in development. In production nothing clears the attributes,
  // so this writes what is already there.
  useLayoutEffect(() => {
    applyChoice(READING_FONT_ATTR, storedChoice(READING_FONT_KEY, READING_FONTS, READING_FONT_DEFAULT))
    applyChoice(READING_SIZE_ATTR, storedChoice(READING_SIZE_KEY, READING_SIZES, READING_SIZE_DEFAULT))
  }, [])

  return (
    <details className="relative">
      <summary className="cursor-pointer font-mono text-xs tracking-wide uppercase underline">
        Reading options
      </summary>
      {/* Absolute, so opening the menu floats over the page instead of shoving the
          article down. DESIGN.md says nothing animates, and a reflow is motion. */}
      <div className="absolute right-0 z-20 mt-2 w-max border border-ink bg-paper px-4 py-3">
        <ReadingRadioGroup
          legend="Typeface"
          name="reading-font"
          options={READING_FONTS}
          chosen={font}
          onChoose={chooseFont}
        />
        <div className="mt-3 border-t border-rule pt-3">
          <ReadingRadioGroup
            legend="Text size"
            name="reading-size"
            options={READING_SIZES}
            chosen={size}
            onChoose={chooseSize}
          />
        </div>
      </div>
    </details>
  )
}
