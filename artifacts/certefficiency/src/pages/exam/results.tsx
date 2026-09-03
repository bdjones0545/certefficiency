import React from "react";
import { getGetMockExamQueryKey, useGetMockExam } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { Trophy, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";

export default function ExamResults({ params }: { params: { id: string } }) {
  const { data: exam, isLoading } = useGetMockExam(params.id, {
    query: { enabled: !!params.id, queryKey: getGetMockExamQueryKey(params.id) },
  });

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading results...</div>;
  if (!exam) return <div className="min-h-screen flex items-center justify-center">Exam not found</div>;

  const score = exam.score || 0;
  const isPass = score >= 70; // Mock threshold

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <Button variant="ghost" asChild className="mb-4 rounded-full">
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Study Partner
          </Link>
        </Button>

        <Card className="card-squircle border-border text-center overflow-hidden">
          <div className={`h-3 w-full ${isPass ? 'bg-success' : 'bg-destructive'}`} />
          <CardContent className="pt-12 pb-12">
            <Trophy className={`w-20 h-20 mx-auto mb-6 ${isPass ? 'text-success' : 'text-muted-foreground'}`} />
            <h1 className="display-text mb-2">{score}%</h1>
            <p className="headline-text text-muted-foreground mb-8">
              {isPass ? "Excellent work. You're ready." : "Keep studying. You'll get there."}
            </p>
            <div className="flex justify-center gap-4">
              <Button size="lg" className="rounded-full px-8">Review Incorrect Answers</Button>
              <Button size="lg" variant="outline" className="rounded-full px-8">Retake Exam</Button>
            </div>
          </CardContent>
        </Card>

        <h2 className="headline-text pt-4">Domain Breakdown</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {/* Mocking domains since real domain data is grouped */}
          {["Domain 1: Planning", "Domain 2: Execution", "Domain 3: Security"].map((d, i) => (
            <Card key={i} className="card-squircle">
              <CardContent className="p-6">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold">{d}</span>
                  <span className="text-muted-foreground font-medium">85%</span>
                </div>
                <div className="h-2 w-full bg-black/5 rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: '85%' }} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
