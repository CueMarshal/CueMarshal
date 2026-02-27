import React, { useState, useEffect, useCallback } from 'react';
import { Activity, AlertCircle, Loader2 } from 'lucide-react';
import { fetchAgentActivity } from '../../services/api';

const AGENTS = [
  { id: 'conductor', name: 'Marshal', species: 'Lion Conductor', avatar: '/images/avatars/marshal.png', color: 'bg-cuemarshal-navy', textClass: 'text-cuemarshal-navy', desc: 'Starts the symphony' },
  { id: 'architect', name: 'Ava', species: 'Snowy Owl Architect', avatar: '/images/avatars/ava.png', color: 'bg-indigo-500', textClass: 'text-indigo-600', desc: 'Wise visionary planner' },
  { id: 'dev', name: 'Dave', species: 'Beaver Developer', avatar: '/images/avatars/dave.png', color: 'bg-green-600', textClass: 'text-green-600', desc: 'Industrious builder' },
  { id: 'reviewer', name: 'Reese', species: 'Bald Eagle Reviewer', avatar: '/images/avatars/reese.png', color: 'bg-amber-500', textClass: 'text-amber-600', desc: 'Laser-sharp critic' },
  { id: 'tester', name: 'Tess', species: 'Raccoon Tester', avatar: '/images/avatars/tess.png', color: 'bg-purple-500', textClass: 'text-purple-600', desc: 'Clever bug washer' },
  { id: 'devops', name: 'Devin', species: 'Octopus DevOps', avatar: '/images/avatars/devin.png', color: 'bg-cyan-600', textClass: 'text-cyan-600', desc: 'Master multi-tasker' },
  { id: 'writer', name: 'Dot', species: 'Parrot Tech Writer', avatar: '/images/avatars/dot.png', color: 'bg-rose-500', textClass: 'text-rose-600', desc: 'Explains it clearly' },
  { id: 'linter', name: 'Linton', species: 'Siamese Cat Linter', avatar: '/images/avatars/linton.png', color: 'bg-slate-700', textClass: 'text-slate-700', desc: 'Picky perfectionist' },
];

// Map agent role names from the API to the AGENTS array ids
const ROLE_TO_ID = {
  conductor: 'conductor',
  architect: 'architect',
  developer: 'dev',
  dev: 'dev',
  reviewer: 'reviewer',
  tester: 'tester',
  devops: 'devops',
  docs: 'writer',
  writer: 'writer',
  linter: 'linter',
};

const STATUS_STYLES = {
  working: {
    label: 'Working',
    bg: 'bg-blue-50',
    text: 'text-cuemarshal-blue',
    border: 'border-blue-100',
    bold: true,
  },
  reviewing: {
    label: 'Reviewing',
    bg: 'bg-amber-50',
    text: 'text-amber-600',
    border: 'border-amber-100',
    bold: true,
  },
  idle: {
    label: 'Idle',
    bg: 'bg-gray-50',
    text: 'text-gray-400',
    border: 'border-gray-100',
    bold: false,
  },
};

function formatTimeAgo(isoString) {
  if (!isoString) return null;
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const POLL_INTERVAL = 10000; // 10 seconds

export default function ActivityView() {
  const [agentData, setAgentData] = useState({}); // keyed by role
  const [pipeline, setPipeline] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadActivity = useCallback(async () => {
    try {
      const data = await fetchAgentActivity();
      setAgentData(data.agents || {});
      setPipeline(data.pipeline || null);
      setLastUpdated(data.timestamp);
      setError(null);
    } catch (err) {
      setError('Unable to reach the platform');
    }
  }, []);

  useEffect(() => {
    loadActivity();
    const interval = setInterval(loadActivity, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadActivity]);

  // Resolve real status for each agent card
  function getAgentStatus(agent) {
    // Check all possible role keys that map to this agent id
    for (const [role, id] of Object.entries(ROLE_TO_ID)) {
      if (id === agent.id && agentData[role]) {
        return agentData[role];
      }
    }
    return null;
  }

  const pipelineActive = pipeline?.status === 'active';

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
        <div className="flex flex-col items-end gap-1">
          <div className={`flex items-center gap-2 text-xs font-mono font-medium px-3 py-1 rounded-full border ${pipelineActive ? 'text-cuemarshal-blue bg-blue-50 border-blue-100' : 'text-gray-400 bg-gray-50 border-gray-200'}`}>
            <span className="relative flex h-2 w-2">
              {pipelineActive ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cuemarshal-blue opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cuemarshal-blue"></span>
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-400"></span>
              )}
            </span>
            {pipelineActive ? 'PIPELINE ACTIVE' : 'PIPELINE IDLE'}
          </div>
          {pipeline && (
            <div className="text-[10px] text-gray-400 font-mono">
              {pipeline.active_jobs} active / {pipeline.queued_jobs} queued
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Agent Cards */}
      <div className="flex-1 overflow-y-auto w-full pb-8 hide-scrollbar">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
          {AGENTS.map((agent) => {
            const activity = getAgentStatus(agent);
            const agentStatus = activity?.status || 'idle';
            const style = STATUS_STYLES[agentStatus] || STATUS_STYLES.idle;
            const isActive = agentStatus !== 'idle';
            const taskCount = (activity?.active_tasks || 0) + (activity?.pending_tasks || 0);
            const recentCompleted = activity?.recent_completed || 0;
            const lastActivity = formatTimeAgo(activity?.last_activity);

            return (
              <div
                key={agent.id}
                className={`relative rounded-xl border p-4 transition-all duration-500
                  ${isActive
                    ? 'border-cuemarshal-blue shadow-lg bg-white translate-y-[-2px]'
                    : 'border-gray-200 bg-white/60 opacity-60 hover:opacity-100'
                  }`}
              >
                {/* Active Indicator Glow */}
                {isActive && (
                  <div className={`absolute -inset-[1px] rounded-xl ${agent.color} opacity-20 blur-sm z-0`}></div>
                )}

                <div className="relative z-10 flex flex-col h-full">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-inner overflow-hidden ${isActive ? agent.color + ' ring-2 ring-offset-2 ring-' + agent.color.split('-')[1] + '-400' : 'bg-gray-100'}`}>
                      {agent.avatar ? (
                        <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                      ) : (
                        <span>{agent.emoji}</span>
                      )}
                    </div>
                    <span className={`text-[10px] font-mono ${style.bg} ${style.text} px-2 py-0.5 rounded border ${style.border} uppercase tracking-widest ${style.bold ? 'font-bold' : ''}`}>
                      {style.label}
                    </span>
                  </div>

                  <h3 className={`font-bold text-lg ${isActive ? agent.textClass : 'text-gray-700'}`}>{agent.name}</h3>
                  <p className="text-xs text-gray-500 font-medium mb-1">{agent.species}</p>

                  {/* Stats row */}
                  <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-1">
                    {taskCount > 0 && <span>{taskCount} task{taskCount !== 1 ? 's' : ''}</span>}
                    {recentCompleted > 0 && <span>{recentCompleted} done (1h)</span>}
                    {lastActivity && <span>{lastActivity}</span>}
                  </div>

                  <p className="text-[13px] text-gray-600 mt-auto pt-2 border-t border-gray-100 leading-snug">
                    {agent.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Team Pulse Feed */}
        <div className="mt-6 flex flex-col gap-4">
          <h3 className="font-montserrat font-bold text-lg text-cuemarshal-navy flex items-center gap-2">
            <div className="relative flex h-3 w-3">
              {pipelineActive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${pipelineActive ? 'bg-green-500' : 'bg-gray-300'}`}></span>
            </div>
            Team Pulse
          </h3>
          
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 min-h-[120px] flex flex-col gap-3 transition-all duration-300">
            {pipeline ? (
              <>
                 {/* Pipeline Status Banner */}
                 <div className={`text-sm font-medium px-3 py-2 rounded-lg flex items-center gap-2 transition-colors duration-300 ${pipelineActive ? 'bg-blue-50 text-cuemarshal-blue border border-blue-100' : 'bg-gray-50 text-gray-500 border border-gray-100'}`}>
                    {pipelineActive ? (
                      <>
                        <Loader2 className="animate-spin w-4 h-4" />
                        <span>{pipeline.active_jobs} active job{pipeline.active_jobs !== 1 ? 's' : ''}, {pipeline.queued_jobs} queued</span>
                      </>
                    ) : (
                      <span>All systems operational. Standing by for tasks.</span>
                    )}
                 </div>

                 {/* Agent Activities Feed */}
                 <div className="space-y-3 pl-1 mt-1">
                   {Object.entries(agentData).map(([role, info]) => {
                      if (info.status === 'idle' && !info.recent_completed) return null;
                      
                      const agentDef = AGENTS.find((a) => {
                        for (const [r, id] of Object.entries(ROLE_TO_ID)) {
                          if (r === role && id === a.id) return true;
                        }
                        return false;
                      });
                      const name = agentDef?.name || role;
                      
                      if (info.status === 'working') {
                        return (
                          <div key={role} className="flex items-start gap-3 text-sm animate-in fade-in slide-in-from-bottom-1 duration-300">
                             <div className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                             <div className="flex-1">
                               <span className="font-semibold text-gray-800">{name}</span>
                               <span className="text-gray-600"> is working on </span>
                               <span className="font-medium text-blue-600">{info.active_tasks} task{info.active_tasks !== 1 ? 's' : ''}</span>
                             </div>
                             <span className="text-xs text-gray-400 tabular-nums font-mono">Now</span>
                          </div>
                        );
                      }
                      
                      if (info.status === 'reviewing') {
                        return (
                          <div key={role} className="flex items-start gap-3 text-sm animate-in fade-in slide-in-from-bottom-1 duration-300">
                             <div className="mt-1.5 w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                             <div className="flex-1">
                               <span className="font-semibold text-gray-800">{name}</span>
                               <span className="text-gray-600"> is reviewing </span>
                               <span className="font-medium text-amber-600">{info.active_tasks} task{info.active_tasks !== 1 ? 's' : ''}</span>
                             </div>
                             <span className="text-xs text-gray-400 tabular-nums font-mono">Now</span>
                          </div>
                        );
                      }

                      if (info.recent_completed) {
                        return (
                          <div key={role} className="flex items-start gap-3 text-sm opacity-75">
                             <div className="mt-1.5 w-2 h-2 rounded-full bg-green-500" />
                             <div className="flex-1">
                               <span className="font-semibold text-gray-700">{name}</span>
                               <span className="text-gray-500"> completed </span>
                               <span className="font-medium text-green-600">{info.recent_completed} task{info.recent_completed !== 1 ? 's' : ''}</span>
                             </div>
                             <span className="text-xs text-gray-400">Recently</span>
                          </div>
                        );
                      }
                      return null;
                   })}
                 </div>
                 
                 {lastUpdated && (
                    <div className="mt-auto pt-2 text-[10px] text-gray-300 text-right">
                      Updated {new Date(lastUpdated).toLocaleTimeString()}
                    </div>
                 )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400 gap-2">
                <Loader2 className="animate-spin w-5 h-5 text-cuemarshal-blue" />
                <span className="text-xs font-medium">Connecting to team feed...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
