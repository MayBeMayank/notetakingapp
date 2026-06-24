import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router-dom'
import { ForgotPasswordSchema, type ForgotPasswordInput } from '@note-app/shared/schemas/auth'
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
import { useForgotPassword } from '@/api/auth'

export function ForgotPasswordForm() {
  const forgot = useForgotPassword()
  // Holds the submitted email once the (always-identical) confirmation is shown.
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(ForgotPasswordSchema),
    defaultValues: { email: '' },
  })

  const onSubmit = (values: ForgotPasswordInput) => {
    // Anti-enumeration: the backend always returns { ok: true }. We show the same
    // confirmation on success regardless of whether the account exists.
    forgot.mutate(values, {
      onSuccess: () => setSubmittedEmail(values.email),
    })
  }

  if (submittedEmail) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Check for your code</CardTitle>
          <CardDescription>
            If an account exists for that email, a 6-digit reset code has been sent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            In development no email is sent — the code is logged to the server console.
          </p>
          <Button asChild className="w-full">
            <Link to="/reset-password" state={{ email: submittedEmail }}>
              Enter reset code
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Forgot password</CardTitle>
        <CardDescription>We&apos;ll send a reset code to your email.</CardDescription>
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
            <Button type="submit" className="w-full" disabled={forgot.isPending}>
              {forgot.isPending ? 'Sending…' : 'Send reset code'}
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
