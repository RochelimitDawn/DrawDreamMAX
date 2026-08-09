export type SplitMode = 'chars' | 'words' | 'lines'

export interface SplitResult {
  words: HTMLElement[]
  chars: HTMLElement[]
  lines: HTMLElement[]
  revert: () => void
}

function wrapTextNode(node: Text, mode: SplitMode, bag: SplitResult) {
  const text = node.textContent ?? ''
  if (!text) return

  const frag = document.createDocumentFragment()

  if (mode === 'words' || mode === 'lines') {
    const parts = text.split(/(\s+)/)
    parts.forEach((part) => {
      if (!part) return
      if (/^\s+$/.test(part)) {
        frag.appendChild(document.createTextNode(part))
        return
      }
      const word = document.createElement('span')
      word.className = 'dd-split-word'
      word.style.display = 'inline-block'
      word.style.whiteSpace = 'pre'
      if (mode === 'words') {
        word.textContent = part
        bag.words.push(word)
      } else {
        ;[...part].forEach((ch) => {
          const char = document.createElement('span')
          char.className = 'dd-split-char'
          char.style.display = 'inline-block'
          char.textContent = ch
          word.appendChild(char)
          bag.chars.push(char)
        })
        bag.words.push(word)
      }
      frag.appendChild(word)
    })
  } else {
    ;[...text].forEach((ch) => {
      if (ch === ' ') {
        frag.appendChild(document.createTextNode(' '))
        return
      }
      const char = document.createElement('span')
      char.className = 'dd-split-char'
      char.style.display = 'inline-block'
      char.style.willChange = 'transform, opacity'
      char.textContent = ch
      bag.chars.push(char)
      frag.appendChild(char)
    })
  }

  node.parentNode?.replaceChild(frag, node)
}

function walk(el: HTMLElement, mode: SplitMode, bag: SplitResult) {
  const children = Array.from(el.childNodes)
  children.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      wrapTextNode(child as Text, mode, bag)
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      walk(child as HTMLElement, mode, bag)
    }
  })
}

/** Lightweight free SplitText alternative for hero titles. */
export function splitElement(el: HTMLElement, mode: SplitMode = 'chars'): SplitResult {
  const original = el.innerHTML
  const bag: SplitResult = {
    words: [],
    chars: [],
    lines: [],
    revert: () => {
      el.innerHTML = original
    },
  }
  walk(el, mode, bag)
  if (mode === 'chars' && bag.chars.length === 0) {
    // fallback if only element children
    walk(el, 'words', bag)
  }
  return bag
}
