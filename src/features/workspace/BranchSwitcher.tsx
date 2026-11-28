import { Store } from 'lucide-react'
import { useBranch } from './branchContext'

/** "Total" or one branch. Shown only to owners of a business that has more than one branch. */
export function BranchSwitcher() {
  const { branches, branchId, setBranchId } = useBranch()
  if (branches.length < 2) return null
  return (
    <div className="branch-switcher" role="group" aria-label="Branch view">
      <span className="branch-switcher-label">
        <Store size={15} aria-hidden="true" /> Viewing
      </span>
      <div className="branch-switcher-options">
        <button
          type="button"
          className={branchId === null ? 'active' : ''}
          aria-pressed={branchId === null}
          onClick={() => setBranchId(null)}
        >
          Total
        </button>
        {branches.map((branch) => (
          <button
            key={branch.id}
            type="button"
            className={branchId === branch.id ? 'active' : ''}
            aria-pressed={branchId === branch.id}
            onClick={() => setBranchId(branch.id)}
          >
            {branch.name}
          </button>
        ))}
      </div>
    </div>
  )
}
