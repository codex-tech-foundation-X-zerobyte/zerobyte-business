import { useEffect } from 'react'

// On phones the stylesheet turns every `.table-wrap` table into a stack of
// labelled cards (a wide table otherwise hides everything but its first
// column behind a sideways scroll). CSS can only print a cell's label if it is
// available as an attribute, so this copies each column header onto the cells
// beneath it. It reads the final DOM, so conditional columns just work.
function labelTable(table: HTMLTableElement) {
  const heads = Array.from(table.tHead?.rows[0]?.cells ?? []).map((cell) => (cell.textContent ?? '').trim())
  // `display: block` on table parts drops native table semantics in some screen readers; restate them.
  table.setAttribute('role', 'table')
  Array.from(table.tBodies).forEach((body) => {
    Array.from(body.rows).forEach((row) => {
      row.setAttribute('role', 'row')
      Array.from(row.cells).forEach((cell, index) => {
        cell.setAttribute('role', 'cell')
        const text = heads[index]
        if (!text || cell.colSpan > 1) cell.removeAttribute('data-label')
        else if (cell.getAttribute('data-label') !== text) cell.setAttribute('data-label', text)
      })
    })
  })
}

// Takes the element itself (not a ref object): the workspace shows a loading skeleton first, so the
// content container mounts later, and the effect must re-run when it does.
export function useStackedTables(element: HTMLElement | null) {
  useEffect(() => {
    if (!element) return
    let frame = 0
    const run = () => {
      frame = 0
      element.querySelectorAll<HTMLTableElement>('.table-wrap table').forEach(labelTable)
    }
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(run) }
    run()
    // childList only: our own attribute writes must not re-trigger the observer.
    const observer = new MutationObserver(schedule)
    observer.observe(element, { childList: true, subtree: true })
    return () => { observer.disconnect(); if (frame) window.cancelAnimationFrame(frame) }
  }, [element])
}
