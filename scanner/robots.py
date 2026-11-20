"""Leitor de robots.txt com curingas (* e $) e a regra do caminho mais específico (o urllib.robotparser do Python ignora os curingas)."""
from __future__ import annotations

import re
from typing import Optional


def _parse(text: str, agent: str) -> list[tuple[bool, str]]:
    """Regras (permite?, padrão) do grupo mais específico para o agente (ou do '*')."""
    agent = agent.lower().split("/")[0]
    groups: list[tuple[list[str], list[tuple[bool, str]]]] = []
    agents: list[str] = []
    rules: list[tuple[bool, str]] = []
    last_was_agent = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent":
            if not last_was_agent:
                if agents:
                    groups.append((agents, rules))
                agents, rules = [], []
            agents.append(value.lower())
            last_was_agent = True
        elif key in ("allow", "disallow"):
            last_was_agent = False
            if value:
                rules.append((key == "allow", value))
    if agents:
        groups.append((agents, rules))
    specific = [r for names, r in groups if any(n != "*" and n in agent for n in names)]
    if specific:
        return [x for r in specific for x in r]
    return [x for names, r in groups if "*" in names for x in r]


def _regex(pattern: str) -> re.Pattern[str]:
    anchored = pattern.endswith("$")
    body = pattern[:-1] if anchored else pattern
    rx = "".join(".*" if c == "*" else re.escape(c) for c in body)
    return re.compile("^" + rx + ("$" if anchored else ""))


def can_fetch(robots_text: Optional[str], agent: str, path_with_query: str) -> bool:
    """O robots.txt permite buscar este caminho (com a query)? Sem robots.txt legível, permitido. Vence a regra mais longa; empate: permite."""
    if robots_text is None:
        return True
    best_len, allowed = -1, True
    for allow, pattern in _parse(robots_text, agent):
        if _regex(pattern).match(path_with_query):
            if len(pattern) > best_len or (len(pattern) == best_len and allow):
                best_len, allowed = len(pattern), allow
    return allowed
