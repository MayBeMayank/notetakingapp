# frontend-app-shell Specification

## MODIFIED Requirements

### Requirement: Application routing
The SPA SHALL expose the auth screens as public routes and SHALL gate everything
else behind authentication, using `react-router-dom`. The authenticated home route
`/` SHALL render the notes list, and the SPA SHALL register protected editor entry
routes `/notes/new` and `/notes/:id` (placeholder screens until AB-1012 supplies the
editor).

#### Scenario: Public auth routes render without a session
- **WHEN** an unauthenticated visitor navigates to `/login`, `/register`, `/forgot-password`, or `/reset-password`
- **THEN** the corresponding screen renders without redirecting, and no access token is required

#### Scenario: Home route renders the notes list
- **WHEN** an authenticated visitor navigates to `/`
- **THEN** the notes list screen renders (replacing the prior minimal home placeholder)

#### Scenario: Editor entry routes are protected
- **WHEN** a visitor navigates to `/notes/new` or `/notes/:id`
- **THEN** an authenticated visitor sees the editor screen (a placeholder until AB-1012), and an unauthenticated visitor is redirected to `/login`

#### Scenario: Unknown route falls back
- **WHEN** a visitor navigates to a path that matches no defined route
- **THEN** the router redirects an unauthenticated visitor to `/login` and an authenticated visitor to the notes list at `/`

#### Scenario: Authenticated visitor on an auth route is redirected home
- **WHEN** a visitor who already holds a valid session opens `/login` or `/register`
- **THEN** the router redirects them to the notes list at `/` instead of showing the auth form
