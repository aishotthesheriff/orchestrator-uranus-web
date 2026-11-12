# InterviewPage Documentation

## Page Overview

**Purpose**: Pre-flight questionnaire interface where players answer interview questions that personalize their game experience. Supports AI-assisted answer generation and multi-question navigation.

**User Flow**:
1. User navigates to `/interview/:gameId`
2. Loads active interview questions
3. Navigates through questions with Previous/Next
4. Optional: Generate AI answers
5. Submit answers → Navigate to game
6. Can skip interview entirely

**Key Features**:
- Multi-question interview flow
- AI answer generation per question
- Progress indicators
- Skip functionality
- Question navigation (Previous/Next)
- Response persistence

## Architecture Review

### Component Dependencies

- **CRTBackground**: Visual background effect
- **wouter**: Routing with params
- **@tanstack/react-query**: Server state management
- **apiRequest**: API client utility

### State Management Patterns

- **Local State**: Current question index, responses object
- **Server State**: Interview questions list
- **Mutations**: Save responses, generate AI answers

### Data Flow

1. Extract gameId from route params
2. Fetch active interview questions
3. User navigates questions, enters responses
4. Optional: Generate AI answer for current question
5. Submit all responses → Save to API → Navigate to game

### Routing Integration

- Entry: `/interview/:gameId` route
- Navigates to: `/game/:gameId` on completion
- Route param: `gameId` extracted via `useRoute`

## Engineering Review

### Code Quality Assessment

**Strengths**:
- Clear question flow logic
- Good error handling
- AI generation feature
- Progress tracking

**Areas for Improvement**:
- Direct fetch calls instead of apiRequest (inconsistent)
- No debouncing on AI generation
- Loading states could be more granular

### Security & CSRF

- Prefer `apiRequest` for all requests to ensure CSRF token attachment and session credentials are included.
- Current implementation uses direct `fetch` for mutations; migrating will align with global error handling (401/403) and token management.

## API Calls

### Synchronous API Calls

None.

### Asynchronous API Calls

**1. Interview Questions Query**
- **Hook**: `useQuery<InterviewQuestion[]>`
- **Query Key**: `['api', 'interview-questions', 'active']`
- **Endpoint**: `GET /api/interview-questions/active`
- **Purpose**: Fetch active interview questions
- **Enabled**: Only when gameId exists
- **Line**: 16-19

### Mutations, Hooks, and Actions

**1. Save Responses Mutation**
- **Hook**: `useMutation`
- **Endpoint**: `PATCH /api/games/${gameId}/interview-responses`
- **Payload**: `Record<string, string>` (responses object)
- **Purpose**: Save all interview responses to game
- **Success**: Invalidates game query, navigates to game
- **Error**: Throws error (handled by React Query)
- **Triggered By**: Final "BEGIN VOYAGE" button or Skip
- **Line**: 21-35

**2. Generate Answer Mutation**
- **Hook**: `useMutation`
- **Endpoint**: `POST /api/interview/generate-answer`
- **Payload**: `{ question: string }`
- **Purpose**: Generate AI answer for current question
- **Success**: Updates responses state with generated answer
- **Error**: Handled by React Query
- **Triggered By**: "POPULATE WITH AI" button
- **Line**: 37-54

**Action Handlers**:

1. **handlePopulateWithAI** (Line 56-63): Triggers AI generation
2. **handleResponseChange** (Line 69-75): Updates response state
3. **handleNext** (Line 77-85): Advances to next question or submits
4. **handlePrevious** (Line 87-91): Goes to previous question
5. **handleSkip** (Line 93-95): Skips interview, saves partial responses

## Dependencies

### React Hooks Used

- `useState`: 2 instances (question index, responses)
- `useEffect`: None
- `useRoute`: Route params extraction

### Custom Hooks

- `useLocation`: Navigation
- `useQuery`, `useMutation`: React Query

### API Endpoints

1. `GET /api/interview-questions/active` - Questions
2. `PATCH /api/games/${gameId}/interview-responses` - Save responses
3. `POST /api/interview/generate-answer` - AI generation

## State Management

### Local State

1. **responses**: `Record<string, string>` - All question responses
2. **currentQuestionIndex**: `number` - Current question position

### Server State

- **questions**: `InterviewQuestion[]` - Interview questions list

## Key Functions & Handlers

See Action Handlers section above.

## Styling & Theming

CRT aesthetic with cyan/orange colors, monospace font, glow effects.

## Testing Considerations

- Question navigation edge cases
- AI generation loading states
- Partial response saving
- Skip functionality
- Error handling

## Known Issues & Technical Debt

- Direct fetch calls (should use apiRequest)
- No debouncing on AI generation
- Magic numbers for styling

## Maintenance Guidelines

- Update question structure if API changes
- Modify AI generation if endpoint changes
- Update routing if game route changes
