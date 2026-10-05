import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const CREATE_EVENT = "ealzy:create";

export function requestCreateHere() {
  window.dispatchEvent(new Event(CREATE_EVENT));
}

export function useCreateIntent(onCreate: () => void) {
  const location = useLocation();
  const navigate = useNavigate();
  const onCreateRef = useRef(onCreate);
  const create = Boolean((location.state as { create?: unknown } | null)?.create);
  useEffect(() => {
    onCreateRef.current = onCreate;
  }, [onCreate]);
  useEffect(() => {
    if (!create) return;
    onCreateRef.current();
    navigate(location.pathname, { replace: true, state: {} });
  }, [create, location.pathname, navigate]);
  useEffect(() => {
    const handleCreate = () => onCreateRef.current();
    window.addEventListener(CREATE_EVENT, handleCreate);
    return () => window.removeEventListener(CREATE_EVENT, handleCreate);
  }, []);
}

export function useOpenOnCreateIntent(setOpen: (open: boolean) => void) {
  useCreateIntent(() => setOpen(true));
}
