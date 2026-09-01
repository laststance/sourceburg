'use client'

import { useEffect, useSyncExternalStore } from 'react'

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

/** Notified after a choice changes. localStorage fires no event in the tab that wrote it. */
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

/** Registers a re-render callback. Returned to React, which calls it to unsubscribe. */
function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => listeners.delete(onStoreChange)
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

/** Two lines each, and no cast: the alternative routed both through one key-sniffing branch. */
function chooseFont(value: ReadingFont): void {
  chosenFont = value
  remember(READING_FONT_KEY, value)
}

function chooseSize(value: ReadingSize): void {
  chosenSize = value
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
          // pair can drift apart. `py-1.5` is what gets a 13px radio to a 44px row.
          <label key={option.value} className="flex cursor-pointer items-center gap-2 py-1.5 text-sm">
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

  // The one place React talks to the DOM. On a hard load the pre-paint script has already
  // set these and this rewrites the same values; it earns its keep in dev, where React's
  // Strict Mode remount resets `<html>` to the attributes it manages from JSX and drops
  // what the script set.
  useEffect(() => {
    document.documentElement.setAttribute(READING_FONT_ATTR, font)
    document.documentElement.setAttribute(READING_SIZE_ATTR, size)
  }, [font, size])

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
