import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useRevokeShare } from '@/api/shares'
import { toAbsoluteShareUrl } from './shareUrl'
import type { ShareLinkItem } from '@/api/shares'

interface ShareLinkRowProps {
  share: ShareLinkItem
}

function formatExpiry(expiresAt: string | null): { label: string; isExpired: boolean } {
  if (!expiresAt) return { label: 'Never expires', isExpired: false }
  const date = new Date(expiresAt)
  const isExpired = date < new Date()
  const label = isExpired
    ? `Expired ${date.toLocaleDateString()}`
    : `Expires ${date.toLocaleDateString()}`
  return { label, isExpired }
}

export function ShareLinkRow({ share }: ShareLinkRowProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const revoke = useRevokeShare()
  const absoluteUrl = toAbsoluteShareUrl(share.url)
  const { label: expiryLabel, isExpired } = formatExpiry(share.expiresAt)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(absoluteUrl)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Could not copy — please copy manually')
    }
  }

  function handleRevoke() {
    revoke.mutate(share.id, {
      onSuccess: () => setConfirmOpen(false),
      onError: (err) => {
        if (err.status === 404) {
          // 404 = already gone; useRevokeShare invalidates the cache so the row disappears
          setConfirmOpen(false)
          return
        }
        toast.error('Failed to revoke link')
        setConfirmOpen(false)
      },
    })
  }

  return (
    <div className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/30">
      {/* URL row */}
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
          {absoluteUrl}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={handleCopy}
        >
          Copy
        </Button>
      </div>

      {/* Meta row: expiry + view count + revoke */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge
            variant={isExpired ? 'destructive' : 'secondary'}
            className="text-xs font-normal"
          >
            {expiryLabel}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {share.viewCount === 1 ? '1 view' : `${share.viewCount} views`}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={revoke.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {revoke.isPending ? 'Revoking…' : 'Revoke'}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Revoke share link?"
        description="This link will immediately stop working for anyone who has it."
        confirmLabel="Revoke"
        cancelLabel="Cancel"
        onConfirm={handleRevoke}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
