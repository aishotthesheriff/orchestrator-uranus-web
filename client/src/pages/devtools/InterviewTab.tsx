import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function InterviewTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Interview Questions</CardTitle>
        <CardDescription>
          Manage pre-flight interview questions that personalize AI-generated content
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground mb-4">
          Interview questions are shown to players when they start a new voyage. Player responses are stored and can be
          referenced in AI prompts using variables like <code>{`{{variableName}}`}</code>.
        </div>
        <div className="text-xs text-muted-foreground">
          To use these responses in AI prompts, add them to your prompt templates using the variable names defined
          below. For example, if you have a question with variableName <code>captainMotivation</code>, you can use{" "}
          <code>{`{{INTERVIEW_captainMotivation}}`}</code> in any prompt.
        </div>
      </CardContent>
    </Card>
  );
}
