import { createContext, useContext } from 'react'

export type BranchOption = { id: string; name: string }

type BranchState = {
  /** Active branches of the workspace (empty for a single-branch business). */
  branches: BranchOption[]
  /** The branch being viewed, or null for the total of all branches. */
  branchId: string | null
  setBranchId: (id: string | null) => void
  /** False for workers, who only ever see what their own access allows. */
  canSwitch: boolean
}

export const BranchContext = createContext<BranchState>({
  branches: [],
  branchId: null,
  setBranchId: () => undefined,
  canSwitch: false,
})

/** Which branch every screen should show: null means the total of all branches. */
export const useBranch = () => useContext(BranchContext)
