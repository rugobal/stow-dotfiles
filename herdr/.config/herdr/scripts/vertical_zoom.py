#!/usr/bin/env python3
import os, sys, json, subprocess

STATE_FILE = os.path.expanduser("~/.herdr_zoom_state.json")
HERDR_BIN = os.environ.get("HERDR_BIN_PATH", "herdr")

def get_layout():
    res = subprocess.run([HERDR_BIN, "api", "snapshot"], capture_output=True, text=True)
    if res.returncode != 0:
        return None
    data = json.loads(res.stdout)
    return data["result"]["snapshot"]

def run_resize(pane, direction, amount):
    subprocess.run([HERDR_BIN, "pane", "resize", "--pane", pane, "--direction", direction, "--amount", str(amount)], capture_output=True)

def main():
    target_pane = os.environ.get("HERDR_PANE_ID")
    if len(sys.argv) > 1:
        target_pane = sys.argv[1]
    
    if not target_pane:
        res = subprocess.run([HERDR_BIN, "pane", "current"], capture_output=True, text=True)
        try:
            data = json.loads(res.stdout)
            target_pane = data["result"]["pane"]["pane_id"]
        except:
            pass

    if not target_pane:
        sys.exit(1)
        
    snapshot = get_layout()
    if not snapshot:
        sys.exit(1)
        
    my_layout = None
    for layout in snapshot.get("layouts", []):
        for p in layout.get("panes", []):
            if p["pane_id"] == target_pane:
                my_layout = layout
                break
        if my_layout:
            break
            
    if not my_layout:
        sys.exit(1)
        
    my_rect = None
    for p in my_layout["panes"]:
        if p["pane_id"] == target_pane:
            my_rect = p["rect"]
            break
            
    column_x = my_rect["x"]
    column_w = my_rect["width"]
    
    col_panes = sorted([p for p in my_layout["panes"] if p["rect"]["x"] == column_x and p["rect"]["width"] == column_w], key=lambda p: p["rect"]["y"])
    if not col_panes:
        sys.exit(0)
    
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                state = json.load(f)
        except:
            state = {}
            
        if state.get("workspace_id") == my_layout["workspace_id"] and state.get("tab_id") == my_layout["tab_id"]:
            # UNZOOM ITERATION
            for _ in range(25):
                snap = get_layout()
                curr_lay = next((l for l in snap.get("layouts", []) if l["workspace_id"] == state["workspace_id"] and l["tab_id"] == state["tab_id"]), None)
                if not curr_lay: break
                
                worst_err = 0
                pane_to_res = None
                res_dir = None
                amt = 0
                
                for saved_s in state.get("splits", []):
                    curr_s = next((s for s in curr_lay["splits"] if s["id"] == saved_s["id"]), None)
                    if not curr_s: continue
                    diff = saved_s["ratio"] - curr_s["ratio"]
                    if abs(diff) > 0.01 and abs(diff) > worst_err:
                        boundary_y = curr_s["rect"]["y"] + curr_s["rect"]["height"] * curr_s["ratio"]
                        
                        cand_pane = None
                        cand_dir = None
                        if diff > 0:
                            for p in curr_lay["panes"]:
                                if p["rect"]["x"] == column_x and p["rect"]["width"] == column_w:
                                    if abs((p["rect"]["y"] + p["rect"]["height"]) - boundary_y) <= 2:
                                        cand_pane = p["pane_id"]
                                        cand_dir = "down"
                                        break
                        else:
                            for p in curr_lay["panes"]:
                                if p["rect"]["x"] == column_x and p["rect"]["width"] == column_w:
                                    if abs(p["rect"]["y"] - boundary_y) <= 2:
                                        cand_pane = p["pane_id"]
                                        cand_dir = "up"
                                        break
                                        
                        if cand_pane:
                            worst_err = abs(diff)
                            pane_to_res = cand_pane
                            res_dir = cand_dir
                            amt = abs(diff)
                            
                if worst_err < 0.01 or not pane_to_res:
                    break
                    
                run_resize(pane_to_res, res_dir, amt)
                
            os.remove(STATE_FILE)
            if state.get("zoomed_pane") != target_pane:
                subprocess.run([sys.executable, os.path.abspath(__file__), target_pane])
            sys.exit(0)
        else:
            os.remove(STATE_FILE)
            
    # ZOOM LOGIC
    col_splits = []
    for s in my_layout["splits"]:
        if s["direction"] == "down" and s["rect"]["x"] == column_x and s["rect"]["width"] == column_w:
            col_splits.append({"id": s["id"], "ratio": s["ratio"]})
            
    if not col_splits:
        sys.exit(0)
        
    state = {
        "workspace_id": my_layout["workspace_id"],
        "tab_id": my_layout["tab_id"],
        "zoomed_pane": target_pane,
        "splits": col_splits
    }
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)
        
    target_idx = next(i for i, p in enumerate(col_panes) if p["pane_id"] == target_pane)
    
    for i in range(target_idx, 0, -1):
        run_resize(col_panes[i]["pane_id"], "up", 1.0)
        
    for i in range(target_idx, len(col_panes) - 1):
        run_resize(col_panes[i]["pane_id"], "down", 1.0)

if __name__ == "__main__":
    main()
