import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Project } from '../types';
import { getProjects } from '../api';

interface ProjectContextValue {
  project: Project | null;
  projects: Project[];
  setProject: (p: Project) => void;
  refreshProjects: () => Promise<void>;
  loading: boolean;
}

const ProjectContext = createContext<ProjectContextValue>({
  project: null,
  projects: [],
  setProject: () => {},
  refreshProjects: async () => {},
  loading: true,
});

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProjectState] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProjects = useCallback(async () => {
    try {
      const list = await getProjects();
      setProjects(list);
      // Restore last selected project from localStorage
      const savedId = localStorage.getItem('kb_project_id');
      const found = list.find(p => p.id === savedId) ?? list[0] ?? null;
      setProjectState(found);
    } catch (e) {
      console.error('Failed to load projects', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  const setProject = useCallback((p: Project) => {
    setProjectState(p);
    localStorage.setItem('kb_project_id', p.id);
  }, []);

  return (
    <ProjectContext.Provider value={{ project, projects, setProject, refreshProjects, loading }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}
