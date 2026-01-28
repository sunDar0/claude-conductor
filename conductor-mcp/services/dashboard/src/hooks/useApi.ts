import { useState, useCallback } from 'react';
import { api } from '../lib/api';

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApi<T>() {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const get = useCallback(async (path: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await api.get<T>(path);
      setState({ data: response.data, loading: false, error: null });
      return response.data;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      setState((s) => ({ ...s, loading: false, error }));
      throw err;
    }
  }, []);

  const post = useCallback(async (path: string, body?: unknown) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await api.post<T>(path, body);
      setState({ data: response.data, loading: false, error: null });
      return response.data;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      setState((s) => ({ ...s, loading: false, error }));
      throw err;
    }
  }, []);

  return { ...state, get, post };
}
