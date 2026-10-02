import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe, login, logout, signup, ApiRequestError } from "./api";

export function App() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const me = useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === "signup") return signup({ email, password, name });
      return login({ email, password });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  if (me.data) {
    return (
      <main style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "system-ui" }}>
        <h1>Connect-Create</h1>
        <p>
          Signed in as {me.data.user.name} ({me.data.user.email})
        </p>
        <button onClick={() => signOut.mutate()}>Log out</button>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Connect-Create</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        {mode === "signup" && (
          <label style={{ display: "block", marginBottom: 8 }}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}
        <label style={{ display: "block", marginBottom: 8 }}>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={submit.isPending}>
          {mode === "signup" ? "Sign up" : "Log in"}
        </button>{" "}
        <button type="button" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
          {mode === "signup" ? "Have an account? Log in" : "Need an account? Sign up"}
        </button>
      </form>
      {submit.error instanceof ApiRequestError && <p role="alert">{submit.error.message}</p>}
    </main>
  );
}
