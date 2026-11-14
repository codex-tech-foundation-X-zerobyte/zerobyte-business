import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { BranchContext, type BranchOption } from './branchContext'

const storageKey = (orgId: string) => `zerobyte.branch.${orgId}`

/** Holds the branch the owner is currently viewing ("Total" or one branch) and remembers it per business. */
export function BranchProvider({
  orgId,
  canSwitch,
  children,
}: {
  orgId: string
  canSwitch: boolean
  children: ReactNode
}) {
  const [branches, setBranches] = useState<BranchOption[]>([])
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return orgId ? window.localStorage.getItem(storageKey(orgId)) : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (!supabase || !orgId || !canSwitch) return
    let active = true
    void Promise.resolve(
      supabase.from('branches').select('id,name').eq('organization_id', orgId).eq('status', 'active').order('name'),
    ).then(({ data }) => {
      if (active) setBranches((data ?? []) as BranchOption[])
    })
    return () => {
      active = false
    }
  }, [orgId, canSwitch])

  const setBranchId = useCallback(
    (id: string | null) => {
      setSelected(id)
      try {
        if (id) window.localStorage.setItem(storageKey(orgId), id)
        else window.localStorage.removeItem(storageKey(orgId))
      } catch {
        // Private browsing: the choice just will not be remembered.
      }
    },
    [orgId],
  )

  // Switching business, or a branch that was closed, goes back to the total.
  const branchId =
    canSwitch && branches.length > 1 && branches.some((branch) => branch.id === selected) ? selected : null
  const value = useMemo(
    () => ({ branches: branches.length > 1 ? branches : [], branchId, setBranchId, canSwitch }),
    [branches, branchId, setBranchId, canSwitch],
  )
  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
}
