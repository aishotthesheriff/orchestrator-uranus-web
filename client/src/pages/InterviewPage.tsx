import { useState, useEffect } from 'react';
import { useLocation, useRoute } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import CRTBackground from '@/components/CRTBackground';
import type { InterviewQuestion } from '@shared/schema';

export default function InterviewPage() {
  const [, params] = useRoute('/interview/:gameId');
  const [, setLocation] = useLocation();
  const gameId = params?.gameId;

  const [responses, setResponses] = useState<Record<string, string>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  const { data: questions, isLoading } = useQuery<InterviewQuestion[]>({
    queryKey: ['api', 'interview-questions', 'active'],
    enabled: !!gameId,
  });

  const saveResponsesMutation = useMutation({
    mutationFn: async (interviewResponses: Record<string, string>) => {
      const response = await fetch(`/api/games/${gameId}/interview-responses`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(interviewResponses),
      });
      if (!response.ok) throw new Error('Failed to save interview responses');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api', 'game', gameId] });
      setLocation(`/game/${gameId}`);
    },
  });

  const generateAnswerMutation = useMutation({
    mutationFn: async ({ question, variableName }: { question: string; variableName: string }) => {
      const response = await fetch('/api/interview/generate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      if (!response.ok) throw new Error('Failed to generate answer');
      const result = await response.json();
      return { ...result, variableName };
    },
    onSuccess: (data) => {
      setResponses(prev => ({
        ...prev,
        [data.variableName]: data.answer,
      }));
    },
  });

  const handlePopulateWithAI = () => {
    if (currentQuestion) {
      generateAnswerMutation.mutate({
        question: currentQuestion.question,
        variableName: currentQuestion.variableName,
      });
    }
  };

  const currentQuestion = questions?.[currentQuestionIndex];
  const isLastQuestion = questions && currentQuestionIndex === questions.length - 1;
  const currentResponse = currentQuestion ? responses[currentQuestion.variableName] || '' : '';

  const handleResponseChange = (value: string) => {
    if (!currentQuestion) return;
    setResponses(prev => ({
      ...prev,
      [currentQuestion.variableName]: value,
    }));
  };

  const handleNext = () => {
    if (!currentQuestion) return;
    
    if (isLastQuestion) {
      saveResponsesMutation.mutate(responses);
    } else {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const handleSkip = () => {
    saveResponsesMutation.mutate(responses);
  };

  if (isLoading || !questions || !currentQuestion) {
    return (
      <div className="relative w-full h-screen overflow-hidden bg-black font-mono text-[#00ffff]">
        <CRTBackground />
        <div className="relative z-10 flex items-center justify-center h-full">
          <div className="text-2xl animate-[flicker_3s_infinite]">
            ▓▒░ LOADING PRE-FLIGHT INTERVIEW ░▒▓
          </div>
        </div>
        <style>{`
          @keyframes flicker {
            0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% { opacity: 1; }
            20%, 24%, 55% { opacity: 0.85; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black font-mono text-[#00ffff]">
      <CRTBackground />

      <div className="relative z-10 flex flex-col items-center justify-center h-full px-4 max-w-4xl mx-auto">
        <div className="w-full space-y-6">
          <div className="text-center mb-8">
            <h1 className="text-4xl md:text-5xl font-bold drop-shadow-[0_0_15px_#00ffff] mb-4 animate-[flicker_3s_infinite]">
              ▓▒░ PRE-FLIGHT INTERVIEW ░▒▓
            </h1>
            <div className="text-[#ffaa00] text-sm">
              [ QUESTION {currentQuestionIndex + 1} / {questions.length} ]
            </div>
          </div>

          <div className="border-2 border-[#00ffff] bg-[#001a1a] p-6 shadow-[0_0_20px_#00ffff]">
            <div className="text-[#ffaa00] text-lg mb-4 font-bold">
              &gt; {currentQuestion.question}
            </div>

            {currentQuestion.description && (
              <div className="text-[#00aaaa] text-sm mb-4 opacity-80">
                ⓘ {currentQuestion.description}
              </div>
            )}

            <div className="flex justify-end mb-2">
              <button
                onClick={handlePopulateWithAI}
                disabled={generateAnswerMutation.isPending}
                className="text-[#00ffff] text-xs hover:text-[#ffaa00] transition-colors underline disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="button-populate-ai"
              >
                {generateAnswerMutation.isPending ? '[ GENERATING... ]' : '[ POPULATE WITH AI ]'}
              </button>
            </div>

            <textarea
              value={currentResponse}
              onChange={(e) => handleResponseChange(e.target.value)}
              className="w-full h-32 px-4 py-3 bg-[#000a0a] border-2 border-[#00aaaa] text-[#00ffff] font-mono text-base focus:outline-none focus:border-[#00ffff] focus:shadow-[0_0_20px_#00ffff] transition-all resize-none"
              placeholder="Type your response here..."
              autoFocus
              data-testid={`input-interview-${currentQuestion.variableName}`}
            />
          </div>

          <div className="flex gap-4 justify-between">
            <button
              onClick={handlePrevious}
              disabled={currentQuestionIndex === 0}
              className="px-6 py-3 border-2 border-[#00aaaa] text-[#00aaaa] bg-[#001a1a] hover:bg-[#002f2f] hover:shadow-[0_0_20px_#00aaaa] disabled:opacity-30 disabled:cursor-not-allowed transition-all font-bold"
              data-testid="button-previous"
            >
              ◀ PREVIOUS
            </button>

            <button
              onClick={handleSkip}
              className="px-6 py-3 border-2 border-[#ffaa00] text-[#ffaa00] bg-[#001a1a] hover:bg-[#2f1f00] hover:shadow-[0_0_20px_#ffaa00] transition-all"
              data-testid="button-skip"
            >
              SKIP INTERVIEW →
            </button>

            <button
              onClick={handleNext}
              disabled={saveResponsesMutation.isPending}
              className="px-6 py-3 border-2 border-[#00ffff] text-[#00ffff] bg-[#001a1a] hover:bg-[#002f2f] hover:shadow-[0_0_30px_#00ffff] disabled:opacity-30 disabled:cursor-not-allowed transition-all font-bold animate-[pulseGlow_4s_infinite]"
              data-testid="button-next"
            >
              {isLastQuestion ? '▶ BEGIN VOYAGE' : '▶ NEXT'}
            </button>
          </div>

          <div className="text-center mt-6">
            <div className="flex justify-center gap-2">
              {questions.map((_, index) => (
                <div
                  key={index}
                  className={`w-3 h-3 border border-[#00ffff] transition-all ${
                    index === currentQuestionIndex
                      ? 'bg-[#00ffff] shadow-[0_0_10px_#00ffff]'
                      : index < currentQuestionIndex
                      ? 'bg-[#00aaaa]'
                      : 'bg-transparent'
                  }`}
                  data-testid={`indicator-question-${index}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="absolute bottom-4 w-full text-center text-[#00aaaa] text-xs opacity-70">
          ░▒▓ YOUR RESPONSES PERSONALIZE YOUR ADVENTURE ▓▒░
        </div>
      </div>

      <style>{`
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 10px #00ffff; }
          50% { box-shadow: 0 0 35px #00ffff; }
        }
        @keyframes flicker {
          0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% { opacity: 1; }
          20%, 24%, 55% { opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}
