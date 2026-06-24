import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { RegisterSchema, type RegisterInput } from '@note-app/shared/schemas/auth'
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
import { useRegister } from '@/api/auth'
import { applyFieldErrors } from '@/features/auth/formErrors'

export function RegisterForm() {
  const navigate = useNavigate()
  const register = useRegister()
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<RegisterInput>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = (values: RegisterInput) => {
    setFormError(null)
    register.mutate(values, {
      // Register returns no tokens — route to login rather than establishing a session.
      onSuccess: () => {
        navigate('/login', {
          replace: true,
          state: { notice: 'Account created — please sign in.' },
        })
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'DUPLICATE_EMAIL') {
          form.setError('email', { type: 'server', message: 'Email already registered' })
          return
        }
        if (!applyFieldErrors<RegisterInput>(error, form.setError)) {
          setFormError(error instanceof ApiError ? error.message : 'Something went wrong')
        }
      },
    })
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>Sign up to start taking notes.</CardDescription>
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
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {formError && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {formError}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={register.isPending}>
              {register.isPending ? 'Creating…' : 'Create account'}
            </Button>
          </form>
        </Form>
        <div className="mt-4 text-sm">
          <Link to="/login" className="text-primary underline-offset-4 hover:underline">
            Already have an account? Sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
