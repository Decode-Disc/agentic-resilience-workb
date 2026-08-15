import { Component, type ErrorInfo, Fragment, type ReactNode } from "react";

import {
    LoadErrorAlert,
    type LoadErrorAlertVariant,
} from "@/components/ui/load-error-alert";

interface LoadErrorBoundaryProps {
    children: ReactNode;
    title: string;
    description: string;
    variant?: LoadErrorAlertVariant;
    className?: string;
    retryLabel?: string;
    onRetry?: () => void;
    onError?: (error: unknown, info: ErrorInfo) => void;
}

interface LoadErrorBoundaryState {
    hasError: boolean;
    retryKey: number;
}

/** Recovers a loading subtree by clearing the error and remounting its children. */
export class LoadErrorBoundary extends Component<
    LoadErrorBoundaryProps,
    LoadErrorBoundaryState
> {
    state: LoadErrorBoundaryState = { hasError: false, retryKey: 0 };

    static getDerivedStateFromError(): Partial<LoadErrorBoundaryState> {
        return { hasError: true };
    }

    componentDidCatch(error: unknown, info: ErrorInfo) {
        this.props.onError?.(error, info);
    }

    private retry = () => {
        this.props.onRetry?.();
        this.setState((state) => ({
            hasError: false,
            retryKey: state.retryKey + 1,
        }));
    };

    render() {
        if (this.state.hasError) {
            return (
                <LoadErrorAlert
                    title={this.props.title}
                    description={this.props.description}
                    variant={this.props.variant}
                    className={this.props.className}
                    retryLabel={this.props.retryLabel}
                    onRetry={this.retry}
                />
            );
        }

        return (
            <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>
        );
    }
}
