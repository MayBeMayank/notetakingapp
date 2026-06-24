import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useLogout } from '@/api/auth'

export function LogoutButton() {
  const navigate = useNavigate()
  const logout = useLogout()

  const onClick = () => {
    // useLogout clears the session in its `finally`, so the local session is dropped
    // even if the network call fails. Redirect to /login on settle either way.
    logout.mutate(undefined, {
      onSettled: () => navigate('/login', { replace: true }),
    })
  }

  return (
    <Button variant="outline" onClick={onClick} disabled={logout.isPending}>
      {logout.isPending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
