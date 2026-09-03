import React, { useState, useEffect } from "react";
import { getGetMockExamQueryKey, useGetMockExam, useSubmitMockExam, useSaveMockExamAnswers, MockExam, MockExamQuestion } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Flag, ArrowLeft, ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";

export default function Exam({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  const { data: exam, isLoading } = useGetMockExam(params.id, {
    query: { enabled: !!params.id, queryKey: getGetMockExamQueryKey(params.id) },
  });
  const submitMutation = useSubmitMockExam();
  const saveAnswers = useSaveMockExamAnswers();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (exam && exam.questions) {
      const initialAns: Record<string, string> = {};
      const initialFlags: Record<string, boolean> = {};
      exam.questions.forEach(q => {
        if (q.selectedOptionId) initialAns[q.id] = q.selectedOptionId;
        if (q.flagged) initialFlags[q.id] = true;
      });
      setAnswers(initialAns);
      setFlagged(initialFlags);
    }
  }, [exam]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading exam...</div>;
  if (!exam || !exam.questions) return <div className="min-h-screen flex items-center justify-center">Exam not found</div>;

  if (exam.status === "graded") {
    setLocation(`/exam/${exam.id}/results`);
    return null;
  }

  const questions = exam.questions;
  const question = questions[currentIndex];

  const handleSelect = (optionId: string) => {
    const newAnswers = { ...answers, [question.id]: optionId };
    setAnswers(newAnswers);
    // Debounce this in a real app
    saveAnswers.mutate({ id: exam.id, data: { answers: [{ questionId: question.id, selectedOptionId: optionId, flagged: flagged[question.id] }] }});
  };

  const toggleFlag = () => {
    const newFlagged = { ...flagged, [question.id]: !flagged[question.id] };
    setFlagged(newFlagged);
    if (answers[question.id]) {
      saveAnswers.mutate({ id: exam.id, data: { answers: [{ questionId: question.id, selectedOptionId: answers[question.id], flagged: newFlagged[question.id] }] }});
    }
  };

  const handleSubmit = () => {
    if (window.confirm("Are you sure you want to submit your exam?")) {
      submitMutation.mutate({ id: exam.id }, {
        onSuccess: () => {
          setLocation(`/exam/${exam.id}/results`);
        }
      });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Header */}
      <header className="h-16 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
        <div className="font-semibold text-lg">{exam.certificationName || "Mock Exam"}</div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-muted-foreground font-mono font-medium">
            <Clock className="w-4 h-4" />
            <span>--:--</span> {/* Add real timer based on exam.startedAt */}
          </div>
          <Button onClick={handleSubmit} disabled={submitMutation.isPending} variant="default" className="h-10 rounded-full">
            Submit Exam
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Question Area */}
        <div className="flex-1 overflow-y-auto p-8 flex justify-center pb-24">
          <div className="w-full max-w-3xl">
            <div className="flex items-center justify-between mb-6">
              <span className="label-text text-muted-foreground">Question {currentIndex + 1} of {questions.length}</span>
              <Button variant="outline" size="sm" className={cn("gap-2 rounded-full", flagged[question.id] && "bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200")} onClick={toggleFlag}>
                <Flag className="w-4 h-4" />
                {flagged[question.id] ? "Flagged" : "Flag for review"}
              </Button>
            </div>

            <Card className="card-squircle border-border shadow-sm p-2">
              <CardContent className="p-6">
                <div className="prose prose-lg dark:prose-invert max-w-none mb-8">
                  <ReactMarkdown>{question.prompt}</ReactMarkdown>
                </div>

                <div className="space-y-3">
                  {question.options.map((opt, i) => {
                    const isSelected = answers[question.id] === opt.id;
                    return (
                      <div 
                        key={opt.id} 
                        onClick={() => handleSelect(opt.id)}
                        className={cn(
                          "p-4 rounded-xl border-2 cursor-pointer transition-all flex gap-4 items-start",
                          isSelected 
                            ? "border-primary bg-primary/5" 
                            : "border-transparent bg-black/5 hover:bg-black/10"
                        )}
                      >
                        <div className={cn(
                          "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5",
                          isSelected ? "border-primary" : "border-muted-foreground/30"
                        )}>
                          {isSelected && <div className="w-3 h-3 rounded-full bg-primary" />}
                        </div>
                        <div className="text-[17px] pt-0.5 leading-relaxed">{opt.text}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between mt-8">
              <Button 
                variant="outline" 
                size="lg" 
                onClick={() => setCurrentIndex(c => Math.max(0, c - 1))}
                disabled={currentIndex === 0}
                className="rounded-full gap-2 px-8"
              >
                <ArrowLeft className="w-5 h-5" /> Previous
              </Button>
              <Button 
                variant="outline" 
                size="lg" 
                onClick={() => setCurrentIndex(c => Math.min(questions.length - 1, c + 1))}
                disabled={currentIndex === questions.length - 1}
                className="rounded-full gap-2 px-8"
              >
                Next <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Sidebar Nav */}
        <div className="w-[320px] border-l border-border bg-card flex flex-col hidden lg:flex">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold text-lg">Questions</h3>
            <p className="text-sm text-muted-foreground">{Object.keys(answers).length} of {questions.length} answered</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, i) => {
                const isAnswered = !!answers[q.id];
                const isFlagged = !!flagged[q.id];
                const isCurrent = i === currentIndex;
                
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentIndex(i)}
                    aria-label={`Question ${i + 1}${isAnswered ? ", answered" : ""}${isFlagged ? ", flagged" : ""}`}
                    aria-current={isCurrent ? "step" : undefined}
                    className={cn(
                      "aspect-square rounded-lg flex items-center justify-center font-medium text-sm transition-colors border",
                      isCurrent ? "ring-2 ring-primary ring-offset-2" : "",
                      isFlagged ? "bg-amber-100 text-amber-700 border-amber-300" :
                      isAnswered ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-black/5"
                    )}
                  >
                    {i + 1}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
