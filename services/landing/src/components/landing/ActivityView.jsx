import React, { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';

const AGENTS = [
  { id: 'conductor', name: 'Marshal', species: 'Lion Conductor', avatar: '/avatars/marshal.png', color: 'bg-cuemarshal-navy', textClass: 'text-cuemarshal-navy', desc: 'Starts the symphony' },
  { id: 'architect', name: 'Ava', species: 'Snowy Owl Architect', avatar: '/avatars/ava.png', color: 'bg-indigo-500', textClass: 'text-indigo-600', desc: 'Wise visionary planner' },
  { id: 'dev', name: 'Dave', species: 'Beaver Developer', avatar: '/avatars/dave.png', color: 'bg-green-600', textClass: 'text-green-600', desc: 'Industrious builder' },
  { id: 'reviewer', name: 'Reese', species: 'Bald Eagle Reviewer', avatar: '/avatars/reese.png', color: 'bg-amber-500', textClass: 'text-amber-600', desc: 'Laser-sharp critic' },
  { id: 'tester', name: 'Tess', species: 'Raccoon Tester', avatar: '/avatars/tess.png', color: 'bg-purple-500', textClass: 'text-purple-600', desc: 'Clever bug washer' },
  { id: 'devops', name: 'Devin', species: 'Octopus DevOps', emoji: '🐙', color: 'bg-cyan-600', textClass: 'text-cyan-600', desc: 'Master multi-tasker' },
  { id: 'writer', name: 'Dot', species: 'Parrot Tech Writer', avatar: '/avatars/dot.png', color: 'bg-rose-500', textClass: 'text-rose-600', desc: 'Explains it clearly' },
  { id: 'linter', name: 'Linton', species: 'Siamese Cat Linter', avatar: '/avatars/linton.png', color: 'bg-slate-700', textClass: 'text-slate-700', desc: 'Picky perfectionist' },
];

export default function ActivityView() {
  const [activeAgent, setActiveAgent] = useState(0);

  // Cycle through agents to simulate activity
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveAgent((prev) => (prev + 1) % AGENTS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-cuemarshal-grey text-cuemarshal-charcoal overflow-hidden p-4 md:p-6 lg:p-8">

      {/* Header */}
      <div className="mb-6 flex justify-between items-end border-b border-gray-200 pb-4 shrink-0">
        <div>
          <h2 className="font-montserrat font-bold text-2xl text-cuemarshal-navy flex items-center gap-2">
            <Activity className="text-cuemarshal-blue" />
            Agent Activity
          </h2>
          <p className="text-sm text-gray-500 mt-1">Live Team Telemetry</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono font-medium text-cuemarshal-blue bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cuemarshal-blue opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cuemarshal-blue"></span>
          </span>
          PIPELINE ACTIVE
        </div>
      </div>

      {/* Agent Hierarchy Diagram */}
      <div className="flex-1 overflow-y-auto w-full pb-8 hide-scrollbar">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
          {AGENTS.map((agent, index) => {
            const isActive = index === activeAgent;
            return (
              <div
                key={agent.id}
                className={`relative rounded-xl border p-4 transition-all duration-500 
                  \${isActive 
                    ? 'border-cuemarshal-blue shadow-lg bg-white translate-y-[-2px]' 
                    : 'border-gray-200 bg-white/60 opacity-60 hover:opacity-100'
                  }`}
              >
                {/* Active Indicator Glow */}
                {isActive && (
                  <div className={`absolute -inset-[1px] rounded-xl \${agent.color} opacity-20 blur-sm z-0`}></div>
                )}

                <div className="relative z-10 flex flex-col h-full">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-inner overflow-hidden \${isActive ? agent.color + ' ring-2 ring-offset-2 ring-' + agent.color.split('-')[1] + '-400' : 'bg-gray-100'}`}>
                      {agent.avatar ? (
                        <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                      ) : (
                        <span>{agent.emoji}</span>
                      )}
                    </div>
                    {isActive ? (
                      <span className="text-[10px] font-mono bg-blue-50 text-cuemarshal-blue px-2 py-0.5 rounded border border-blue-100 uppercase tracking-widest font-bold">
                        Working
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono bg-gray-50 text-gray-400 px-2 py-0.5 rounded border border-gray-100 uppercase">
                        Idle
                      </span>
                    )}
                  </div>

                  <h3 className={`font-bold text-lg \${isActive ? agent.textClass : 'text-gray-700'}`}>{agent.name}</h3>
                  <p className="text-xs text-gray-500 font-medium mb-1">{agent.species}</p>
                  <p className="text-[13px] text-gray-600 mt-auto pt-2 border-t border-gray-100 leading-snug">
                    {agent.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Terminal Simulation */}
        <div className="mt-6 rounded-xl overflow-hidden border border-gray-200 shadow-sm bg-cuemarshal-navy text-gray-300 font-mono text-xs w-full">
          <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-800">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
            </div>
            <div className="text-gray-500 text-[10px]">cuemarshal/pipeline</div>
          </div>
          <div className="p-4 space-y-1.5 min-h-[140px]">
            <div className="text-green-400">➜  ~ cue start main-pipeline</div>
            <div className="opacity-70">[10:05:01] Marshal (Lion): Orchestrating kickoff...</div>
            <div className={`transition-opacity duration-300 \${activeAgent === 1 ? 'text-indigo-400 opacity-100' : 'opacity-70'}`}>[10:05:02] Ava (Owl): Planning task graph...</div>
            <div className={`transition-opacity duration-300 \${activeAgent === 2 ? 'text-green-400 opacity-100 font-bold' : 'opacity-70'}`}>[10:05:03] Dave (Beaver): Writing ImplementationPlan.md...</div>
            {activeAgent === 2 && (
              <div className="pl-4 text-gray-400 border-l border-gray-700 ml-1 py-1 animate-pulse">
                Building file structure...<br />
                Compiling components...
              </div>
            )}
            <div className={`transition-opacity duration-300 \${activeAgent >= 3 ? 'text-green-400' : 'text-transparent'}`}>[10:05:04] Task graph complete. Subagents processing.</div>
            <div className={`transition-opacity duration-300 \${activeAgent >= 3 ? 'text-yellow-400 opacity-100 flex items-center gap-2' : 'text-transparent'}`}>
              <div className="animate-spin h-3 w-3 border-2 border-yellow-400 border-t-transparent rounded-full" />
              Waiting on PR review from Reese (Eagle)...
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
