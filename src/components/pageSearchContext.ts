import { createContext } from 'react'

// Lets the few pages that have a list to filter (Inventory, Customers, Records) show a search box right under their
// title, without every page having to be rewired. Pages without it simply get nothing.
export type PageSearch = { value: string; onChange: (value: string) => void; placeholder: string }
export const PageSearchContext = createContext<PageSearch | null>(null)
