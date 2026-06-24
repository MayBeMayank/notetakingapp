import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ResetPasswordSchema, type ResetPasswordInput } from '@note-app/shared/schemas/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { ApiError } from '@/api/client'
import { useResetPassword } from '@/api/auth'

export function ResetPasswordForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const reset = useResetPassword()
  const prefillEmail = (location.state as { email?: string } | null)?.email ?? ''
  const [formError, setFormError] = useState<string | null>(null)
  // True when the OTP was invalidated by exceeding the 5-attempt cap.
  const [attemptsExhausted, setAttemptsExhausted] = useState(false)

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(ResetPasswordSchema),
    defaultValues: { email: prefillEmail, otp: '', newPassword: '' },
  })

  const onSubmit = (values: ResetPasswordInput) => {
    setFormError(null)
    setAttemptsExhausted(false)
    reset.mutate(values, {
      onSuccess: () => {
        navigate('/login', {
          replace: true,
          state: { notice: 'Password reset — please sign in with your new password.' },
        })
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'OTP_ATTEMPT_LIMIT_REACHED') {
          setAttemptsExhausted(true)
          return
        }
        setFormError(
          error instanceof ApiError
            ? error.message
            : 'Something went wrong',
        )
      },
    })
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Reset password</CardTitle>
        <CardDescription>Enter the code sent to your email and a new password.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="otp"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reset code</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" maxLength={6} placeholder="6-digit code" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {attemptsExhausted && (
              <p role="alert" className="text-sm font-medium text-destructive">
                Too many failed attempts. Please{' '}
                <Link to="/forgot-password" className="underline underline-offset-4">
                  request a new code
                </Link>
                .
              </p>
            )}
            {formError && !attemptsExhausted && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {formError}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={reset.isPending}>
              {reset.isPending ? 'Resetting…' : 'Reset password'}
            </Button>
          </form>
        </Form>
        <div className="mt-4 text-sm">
          <Link to="/login" className="text-primary underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
